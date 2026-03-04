const { databases } = require("../config/appwrite");
const { Query } = require("appwrite");

const getTodayString = () => {
  return new Date().toISOString().split("T")[0];
};

const isSunday = () => {
  if (process.env.DISABLE_SUNDAY === "true") return false;
  return new Date().getDay() === 0;
};

const bodyRotation = [
  ["chest", "arms"],
  ["legs", "back"],
  ["shoulders", "abs"],
];

exports.getTodayWorkout = async (req, res) => {
  try {
    const userId = req.userId;
    const today = getTodayString();

    if (isSunday()) {
      return res.status(200).json({ restDay: true });
    }

    // Check if session already exists
    const existing = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      [Query.equal("userId", userId), Query.equal("date", today)],
    );

    if (existing.total > 0) {
      return res.status(200).json(existing.documents[0]);
    }

    // Fetch user profile
    const profile = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
    );
    if (profile.pause) {
      return res.status(403).json({
        blocked: true,
        reason: "paused",
        message: "Workouts are currently paused. Resume when ready.",
      });
    }

    // ---- ABSENCE BLOCK CHECK ----
    const streakDoc = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
    );

    if (streakDoc.lastWorkoutDate) {
      const todayDate = new Date();
      const lastDate = new Date(streakDoc.lastWorkoutDate);

      const diff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

      if (diff > 1 && !profile.pause && !profile.absencePending) {
        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_PROFILE_COLLECTION_ID,
          userId,
          { absencePending: true },
        );

        return res.status(403).json({
          blocked: true,
          reason: "absence_unresolved",
          message:
            "You missed some days. Please confirm whether you were ill before continuing workouts.",
        });
      }
    }

    const completedDays = profile.completedWorkoutDays || 0;
    const rotationIndex = completedDays % 3;
    const bodyParts = bodyRotation[rotationIndex];

    let level = profile.currentLevel || "easy";

    // ---- DOWNGRADE CHECK ----
    if (profile.downgradeUntil) {
      const todayDate = new Date();
      const downgradeDate = new Date(profile.downgradeUntil);

      if (todayDate <= downgradeDate) {
        if (level === "hard") level = "medium";
        else if (level === "medium") level = "easy";
      } else {
        // downgrade period over → clear it
        await databases.updateDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_PROFILE_COLLECTION_ID,
          userId,
          { downgradeUntil: null },
        );
      }
    }

    const exercises = [];

    for (const part of bodyParts) {
      const result = await databases.listDocuments(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_EXERCISE_COLLECTION_ID,
        [Query.equal("bodyPart", part), Query.equal("level", level)],
      );

      const filtered = profile.hasDumbbell
        ? result.documents
        : result.documents.filter((e) => !e.requiresDumbbell);

      const selected = filtered.slice(0, 3);

      exercises.push(...selected);
    }

    const session = await databases.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      userId + "_" + today,
      {
        userId,
        date: today,
        bodyParts,
        exercises: JSON.stringify(exercises),
        completed: false,
        caloriesBurned: 0,
      },
    );

    return res.status(200).json(session);
  } catch (error) {
    console.error("WORKOUT ERROR:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.completeWorkout = async (req, res) => {
  try {
    const userId = req.userId;
    const today = getTodayString();
    const repsData = req.body;

    const session = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      userId + "_" + today,
    );
    if (session.completed) {
      return res.status(400).json({
        error: "Workout already completed today.",
      });
    }

    const profile = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
    );

    if (profile.absencePending) {
      return res.status(403).json({
        error: "Resolve absence confirmation before completing workout.",
      });
    }

    const exercises = JSON.parse(session.exercises);

    let totalCalories = 0;

    for (const entry of repsData) {
      const exercise = exercises.find((e) => e.$id === entry.exerciseId);

      if (!exercise) continue;

      const totalSeconds = entry.repsCompleted * exercise.avgRepSeconds;

      const durationHours = totalSeconds / 3600;

      const calories = exercise.MET * profile.weight * durationHours;

      totalCalories += calories;
    }

    // Update workout session
    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      userId + "_" + today,
      {
        completed: true,
        caloriesBurned: totalCalories,
      },
    );

    // ---- UPDATE COMPLETED DAYS ----
    const newCompletedDays = (profile.completedWorkoutDays || 0) + 1;

    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
      {
        completedWorkoutDays: newCompletedDays,
      },
    );

    // ---- LEVEL PROGRESSION ----
    let newLevel = profile.currentLevel || "easy";

    if (newCompletedDays >= 30) {
      newLevel = "hard";
    } else if (newCompletedDays >= 14) {
      newLevel = "medium";
    }

    if (newLevel !== profile.currentLevel) {
      await databases.updateDocument(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_PROFILE_COLLECTION_ID,
        userId,
        { currentLevel: newLevel },
      );
    }

    const {
      calculateBMR,
      calculateTDEE,
      calculateTarget,
    } = require("../utils/calorieEngine");

    const updatedProfile = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
    );

    const BMR = calculateBMR(updatedProfile);
    const TDEE = calculateTDEE(BMR, updatedProfile.currentLevel);
    const dailyTarget = calculateTarget(TDEE, updatedProfile.goal);

    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
      {
        BMR,
        TDEE,
        dailyCalorieTarget: dailyTarget,
      },
    );

    // ---- STREAK LOGIC ----
    const streakDoc = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
    );

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    let newStreak = 1;

    if (streakDoc.lastWorkoutDate === yesterdayStr) {
      newStreak = (streakDoc.currentStreak || 0) + 1;
    }

    const newLongest = Math.max(streakDoc.longestStreak || 0, newStreak);

    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
      {
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastWorkoutDate: today,
      },
    );

    const { updateDailySummary } = require("../utils/dailySummaryEngine");

    await updateDailySummary(userId);

    res.status(200).json({
      caloriesBurned: totalCalories,
      completedWorkoutDays: newCompletedDays,
      currentStreak: newStreak,
      newLevel,
    });
  } catch (error) {
    console.error("COMPLETE ERROR:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.getJourney = async (req, res) => {
  try {
    const userId = req.userId;

    // Get workouts
    const workouts = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      [
        Query.equal("userId", userId),
        Query.equal("completed", true), // 🔥 Only completed workouts
      ],
    );

    // Get unique workout dates
    const dates = [...new Set(workouts.documents.map((w) => w.date))].sort();

    const completedCount = dates.length;

    const completedDays = Array.from(
      { length: completedCount },
      (_, i) => i + 1,
    );

    const currentDay = completedCount + 1;

    // Get streak
    const streakDoc = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
    );

    res.status(200).json({
      totalDays: 90,
      completedDays,
      completedDates: dates,
      currentDay,
      streak: streakDoc.currentStreak,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
