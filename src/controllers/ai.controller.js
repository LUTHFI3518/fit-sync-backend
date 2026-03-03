const axios = require("axios");
const { updateDailySummary } = require("../utils/dailySummaryEngine");
const { databases } = require("../config/appwrite");
const { Query } = require("appwrite");
const { ID } = require("appwrite");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

exports.chat = async (req, res) => {
  try {
    const userId = req.userId;
    const { message } = req.body;

    const messages = [
      {
        role: "system",
        content: `
        You are FitSync AI, a professional dietitian and gym coach.

        Rules:
        - If user mentions eating food → estimate and call log_food.
        - If user asks about progress, calories, deficit, surplus → call get_daily_summary.
        - If missing details for food logging → ask clarification.
        - Never fabricate backend data.
        - Always use tools when required.
        - If user asks about workout or today's training → call get_today_workout.
        - If user mentions illness or needing rest → call pause_workout.
        - If user says they are ready to train again → call resume_workout.
        `,
      },
      {
        role: "user",
        content: message,
      },
    ];

    const profile = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
    );

    const streakDoc = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
    );

    const lastDate = streakDoc.lastWorkoutDate;

    let inactivityDays = 0;

    if (lastDate) {
      const diff = Math.floor(
        (new Date() - new Date(lastDate)) / (1000 * 60 * 60 * 24),
      );
      inactivityDays = diff;
    }

    if (inactivityDays > 1 && !profile.pause && !profile.absencePending) {
      messages.unshift({
        role: "system",
        content: `
        User has been inactive for ${inactivityDays} days.
        You must ask whether they were ill.
        If user confirms illness → call pause_workout.
        If user says they were not sick → call break_streak.
        Do not assume.
        `,
      });
    }
    if (profile.absencePending) {
      messages.unshift({
        role: "system",
        content: `
        User has absencePending = true.
        You must ask whether they were ill.
        If user confirms illness → call pause_workout.
        If user denies illness → call break_streak.
        After resolving, absencePending must be cleared.
        `,
      });
    }

    const response = await axios.post(
      OPENROUTER_URL,
      {
        model: "openai/gpt-oss-120b:free",
        messages,
        tools: [
          {
            type: "function",
            function: {
              name: "log_food",
              description: "Log food intake for the user",
              parameters: {
                type: "object",
                properties: {
                  foodName: { type: "string" },
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fats: { type: "number" },
                  mealType: {
                    type: "string",
                    enum: ["breakfast", "lunch", "dinner"],
                  },
                },
                required: ["foodName", "calories"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get_daily_summary",
              description: "Get today's calorie balance summary",
              parameters: {
                type: "object",
                properties: {},
                required: [],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get_today_workout",
              description: "Get today's workout session for the user",
              parameters: {
                type: "object",
                properties: {},
                required: [],
              },
            },
          },

          {
            type: "function",
            function: {
              name: "pause_workout",
              description: "Pause workouts for illness or recovery",
              parameters: {
                type: "object",
                properties: {},
                required: [],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "resume_workout",
              description: "Resume workouts after pause",
              parameters: {
                type: "object",
                properties: {},
                required: [],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "break_streak",
              description: "Break user's workout streak due to absence",
              parameters: {
                type: "object",
                properties: {},
                required: [],
              },
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const aiMessage = response.data.choices[0].message;

    // 🔥 If AI calls tool
    if (aiMessage.tool_calls) {
      const toolCall = aiMessage.tool_calls[0];
      const toolName = toolCall.function.name;
      const args = toolCall.function.arguments
        ? JSON.parse(toolCall.function.arguments)
        : {};

      // 🔥 FOOD LOG TOOL
      if (toolName === "log_food") {
        let mealType = null;

        // Only accept AI mealType if user explicitly mentioned it
        const userMessageLower = message.toLowerCase();

        if (
          args.mealType &&
          (userMessageLower.includes("breakfast") ||
            userMessageLower.includes("lunch") ||
            userMessageLower.includes("dinner"))
        ) {
          mealType = args.mealType;
        }

        if (!mealType) {
          const hour = new Date().getHours();

          if (hour < 12) mealType = "breakfast";
          else if (hour < 18) mealType = "lunch";
          else mealType = "dinner";
        }
        console.log("Server hour:", new Date().getHours());
        console.log("AI args:", args);

        await databases.createDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_FOOD_COLLECTION_ID,

          ID.unique(),
          {
            userId,
            date: new Date().toISOString().split("T")[0],
            foodName: args.foodName,
            calories: args.calories,
            protein: args.protein || 0,
            carbs: args.carbs || 0,
            fats: args.fats || 0,
            mealType: mealType,
          },
        );

        const summary = await updateDailySummary(userId);

        return res.status(200).json({
          reply: `
        Food logged successfully.

        Energy spent: ${summary.energySpent.toFixed(0)} kcal
        Intake: ${summary.intake.toFixed(0)} kcal
        Balance: ${summary.balance.toFixed(0)} kcal
        Status: ${summary.status}
      `,
        });
      }

      // 🔥 DAILY SUMMARY TOOL
      if (toolName === "get_daily_summary") {
        const summary = await updateDailySummary(userId);

        return res.status(200).json({
          reply: `
        Here’s your progress for today:

        Energy spent (BMR + workout): ${summary.energySpent.toFixed(0)} kcal
        Total intake: ${summary.intake.toFixed(0)} kcal
        Balance: ${summary.balance.toFixed(0)} kcal
        Status: ${summary.status}
      `,
        });
      }
      // 🔥 TODAY'S WORKOUT TOOL
      if (toolName === "get_today_workout") {
        const today = new Date().toISOString().split("T")[0];

        const workout = await databases.listDocuments(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_WORKOUT_COLLECTION_ID,
          [Query.equal("userId", userId), Query.equal("date", today)],
        );
        const profile = await databases.getDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_PROFILE_COLLECTION_ID,
          userId,
        );

        if (workout.total === 0) {
          return res.status(200).json({
            reply: "Today is a rest day. Focus on recovery and hydration.",
          });
        }

        const session = workout.documents[0];

        if (session.isRestDay) {
          return res.status(200).json({
            reply: "Today is Sunday — rest day. Recovery is part of growth.",
          });
        }

        const exercises = JSON.parse(session.exercises);

        let formatted = `Today's Workout:\n\n`;

        exercises.forEach((ex, index) => {
          formatted += `${index + 1}. ${ex.name} — ${ex.targetReps} reps\n`;
        });

        formatted += `\nLevel: ${profile.currentLevel}`;

        return res.status(200).json({
          reply: formatted,
        });
      }
      // 🔥 PAUSE WORKOUT TOOL

      if (toolName === "pause_workout") {
        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_PROFILE_COLLECTION_ID,
          userId,
          {
            pause: true,
            absencePending: false,
          },
        );

        return res.status(200).json({
          reply:
            "Workout sessions have been paused. Focus on recovery and hydration. Your streak is protected.",
        });
      }
      // 🔥 RESUME WORKOUT TOOL
      if (toolName === "resume_workout") {
        const downgradeUntil = new Date();
        downgradeUntil.setDate(downgradeUntil.getDate() + 2);

        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_PROFILE_COLLECTION_ID,
          userId,
          {
            pause: false,
            downgradeUntil: downgradeUntil.toISOString().split("T")[0],
          },
        );

        return res.status(200).json({
          reply:
            "Welcome back! Workouts resumed. Intensity will be slightly reduced for 2 days to help you ease back in.",
        });
      }
      // 🔥 BREAK STREAK TOOL
      if (toolName === "break_streak") {
        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_STREAK_COLLECTION_ID,
          userId,
          {
            currentStreak: 0,
          },
        );
        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_PROFILE_COLLECTION_ID,
          userId,
          {
            absencePending: false,
          },
        );

        return res.status(200).json({
          reply: "Your streak has been reset. Let’s restart strong today 💪",
        });
      }
    }

    // Normal reply
    return res.status(200).json({
      reply: aiMessage.content,
    });
  } catch (error) {
    console.error("AI ERROR:", error.response?.data || error.message);
    res.status(500).json({ error: "AI failed" });
  }
};
