const axios = require("axios");
const { updateDailySummary } = require("../utils/dailySummaryEngine");
const { databases } = require("../config/appwrite");
const { Query } = require("appwrite");
const { ID } = require("appwrite");
const groqService = require("../services/groq.service");
const visionService = require("../services/vision.service");
const { aiTools } = require("../ai/tools");

exports.chat = async (req, res) => {
  try {
    const userId = req.userId;
    const { message, history } = req.body;

    const messages = [
      {
        role: "system",
        content: `
        You are FitSync AI, a professional dietitian and gym coach.

        Rules:
        - ONLY call log_food if the user is EXPLICITLY telling you they just ate a meal and providing details. DO NOT call log_food if they are asking general questions about food or diet history.
        - When calling log_food, you MUST estimate and provide the exact 'calories', 'protein', 'carbs', and 'fats' based on standard nutritional data! NEVER leave calories as 0!
        - If user asks about progress, calories, deficit, surplus → call get_daily_summary.
        - If missing details for food logging → ask clarification.
        - Never fabricate backend database records, but DO use your knowledge to estimate macros strictly for log_food.
        - Always use tools when required.
        - If user asks about workout or today's training → call get_today_workout.
        - If user mentions illness or needing rest → call pause_workout.
        - If user says they are ready to train again → call resume_workout.
        `,
      },
    ];

    if (history && Array.isArray(history)) {
      messages.push(...history.slice(-10)); // keep last 10 lines max context
    }

    messages.push({
      role: "user",
      content: message,
    });

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

    const aiMessage = await groqService.chat(messages, [
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
            type: "string"
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
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_workout",
      description: "Pause workouts for illness or recovery",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "resume_workout",
      description: "Resume workouts after pause",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "break_streak",
      description: "Break user's workout streak due to absence",
      parameters: { type: "object", properties: {} },
    },
  },
]);

    // 🔥 If AI calls tool
    if (aiMessage.tool_calls) {
      const toolCall = aiMessage.tool_calls[0];
      const toolName = toolCall.function.name;
      let args = {};
      try {
        args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
      } catch (err) {
        console.error("Groq JSON Parse error on arguments", err);
        return res.status(200).json({ reply: "I understood your food, but could you clarify how much you ate?" });
      }

      if (toolName === "log_food") {
        if (args.calories === undefined || args.calories === null) {
          return res.status(200).json({
            reply: `I see you had ${args.foodName || "that"}, but how much did you eat? I need the portion size to estimate the calories!`
          });
        }

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
          const istTimeString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
          const hour = new Date(istTimeString).getHours();

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
          reply: `✅ **Logged ${args.foodName}**
🔥 Calories: ${args.calories} kcal
🥩 P: ${args.protein || 0}g | 🍞 C: ${args.carbs || 0}g | 🥑 F: ${args.fats || 0}g
🕒 Meal: ${mealType}

📊 **Today's Summary**
Energy spent: ${summary.energySpent.toFixed(0)} kcal
Intake: ${summary.intake.toFixed(0)} kcal
Balance: ${summary.balance.toFixed(0)} kcal
Status: ${summary.status}`,
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

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];

        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_STREAK_COLLECTION_ID,
          userId,
          {
            lastWorkoutDate: yesterdayStr,
          },
        );

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
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];

        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_STREAK_COLLECTION_ID,
          userId,
          {
            currentStreak: 0,
            lastWorkoutDate: yesterdayStr,
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



exports.foodImage = async (req, res) => {
  try {
    const userId = req.userId;
    const { image, history } = req.body;

    const visionResult = await visionService.recognizeFood(image);

    const { foodName, estimatedQuantity, unit, confidence } = visionResult;

    if (confidence && confidence < 0.6) {
      return res.status(200).json({
        detectedFood: visionResult,
        reply: `I think this is ${foodName}, but I'm not fully sure. Can you confirm what food this is and how much you ate?`
      });
    }

    const messages = [
      {
        role: "system",
        content: `
User uploaded a food photo.
Vision AI detected: ${foodName} (Estimated quantity: ${estimatedQuantity || "unknown"} ${unit || ""}).
CRITICAL POLICY: DO NOT call log_food right now. You MUST act as an interactive assistant. Politely tell the user what food you detected and ask them to confirm the exact portion size before logging anything.
`
      }
    ];

    if (history && Array.isArray(history)) {
      messages.push(...history.slice(-10));
    }

    messages.push({
      role: "user",
      content: "[User uploaded a photo of their meal]"
    });

    const aiMessage = await groqService.chat(
      messages,
      aiTools
    );

    if (aiMessage.tool_calls) {
      const toolCall = aiMessage.tool_calls[0];
      const toolName = toolCall.function.name;
      const args = toolCall.function.arguments
        ? JSON.parse(toolCall.function.arguments)
        : {};

      if (toolName === "log_food") {
        let mealType = null;
        const hour = new Date().getHours();
        if (hour < 12) mealType = "breakfast";
        else if (hour < 18) mealType = "lunch";
        else mealType = "dinner";

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
          detectedFood: visionResult,
          reply: `✅ **Logged ${args.foodName}**
🔥 Calories: ${args.calories} kcal
🥩 P: ${args.protein || 0}g | 🍞 C: ${args.carbs || 0}g | 🥑 F: ${args.fats || 0}g
🕒 Meal: ${mealType}

📊 **Today's Summary**
Energy spent: ${summary.energySpent.toFixed(0)} kcal
Intake: ${summary.intake.toFixed(0)} kcal
Balance: ${summary.balance.toFixed(0)} kcal
Status: ${summary.status}`,
        });
      }
    }

    return res.status(200).json({
      detectedFood: visionResult,
      reply: aiMessage.content
    });

  } catch (error) {
    console.error("IMAGE AI ERROR:", error.message);
    res.status(error.response?.status === 429 ? 429 : 500).json({
      error: error.message || "Image AI failed",
    });
  }
};