const { databases } = require("../config/appwrite");
const { Query } = require("appwrite");

const { getTodayString, getISTDateString, getISTDay } = require("../utils/dateUtils");

const isSunday = () => {
  if (process.env.DISABLE_SUNDAY === "true") return false;
  return getISTDay() === 0;
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

    let level = profile.currentLevel || profile.level || "easy";

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
    const allLevels = ["easy", "medium", "hard"];
    const targetLevelIdx = allLevels.indexOf(level);

    for (const part of bodyParts) {
      let partExercises = [];
      
      // We try the target level first, then search other levels if we don't have enough safe exercises
      // Search order: [targetLevel, others...]
      const searchLevels = [
        level, 
        ...allLevels.filter(l => l !== level) 
      ];

      for (const searchLevel of searchLevels) {
        if (partExercises.length >= 3) break;

        const result = await databases.listDocuments(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_EXERCISE_COLLECTION_ID,
          [Query.equal("bodyPart", part), Query.equal("level", searchLevel)],
        );

        let filtered = result.documents.filter((e) => {
          // 1. Dumbbell Filter
          if (!profile.hasDumbbell && e.requiresDumbbell) return false;

          // 2. Back Pain Filter
          if (profile.hasBackPain && e.isBackSafe === false) return false;

          // 3. Knee Pain Filter
          if (profile.hasKneePain && e.isKneeSafe === false) return false;

          return true;
        });

        // Add unique exercises to our pool for this body part
        for (const f of filtered) {
          if (partExercises.length < 3 && !partExercises.find(ex => ex.$id === f.$id)) {
            partExercises.push(f);
          }
        }
      }

      // Final fallback: if even across all levels we don't have enough safe exercises,
      // we just take what we found (safety first).
      partExercises.sort(() => Math.random() - 0.5);
      exercises.push(...partExercises);
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

    const yesterdayStr = getISTDateString(-1);

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

    // Get user profile to determine plan duration
    const profile = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
    );

    // planDuration is stored in months (3 or 6); convert to days
    const planMonths = profile.planDuration || 3;
    const totalDays = planMonths * 30;

    // Get completed workouts
    const workouts = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      [
        Query.equal("userId", userId),
        Query.equal("completed", true),
      ],
    );

    // Get unique workout dates
    const dates = [...new Set(workouts.documents.map((w) => w.date))].sort();

    const completedCount = dates.length;

    const completedDays = Array.from(
      { length: completedCount },
      (_, i) => i + 1,
    );

    const currentDay = Math.min(completedCount + 1, totalDays);

    // Get streak
    const streakDoc = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
    );

    res.status(200).json({
      totalDays,
      planMonths,
      completedDays,
      completedDates: dates,
      currentDay,
      streak: streakDoc.currentStreak,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getExerciseInfo = async (req, res) => {
  try {
    const { name } = req.params;
    
    const docs = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      "exercises", // matches our populated collection ID
      [Query.equal("name", name)]
    );

    if (docs.total === 0) {
      return res.status(404).json({ error: "Exercise info not found" });
    }

    const { description, gifUrl } = docs.documents[0];
    res.status(200).json({ description, gifUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.completeExercise = async (req, res) => {
  try {
    const userId = req.userId;
    const today = getTodayString();
    const { exerciseId, repsCompleted } = req.body;

    if (!exerciseId) {
      return res.status(400).json({ error: "exerciseId is required" });
    }

    // Load today's session
    const session = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      userId + "_" + today,
    );

    if (session.completed) {
      return res.status(200).json({ allDone: true, alreadyCompleted: true });
    }

    // Parse existing completed exercises list
    let completedExercises = [];
    if (session.completedExercises) {
      try {
        completedExercises = JSON.parse(session.completedExercises);
      } catch (_) {}
    }

    // Avoid duplicate completions for the same exercise
    const alreadyDone = completedExercises.some(
      (e) => e.exerciseId === exerciseId,
    );
    if (!alreadyDone) {
      completedExercises.push({
        exerciseId,
        repsCompleted: repsCompleted || 0,
      });
      await databases.updateDocument(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_WORKOUT_COLLECTION_ID,
        userId + "_" + today,
        { completedExercises: JSON.stringify(completedExercises) },
      );
    }

    // Check if all exercises in the session are done
    const exercises = JSON.parse(session.exercises);
    const totalExercises = exercises.length;
    const doneCount = completedExercises.length;

    if (doneCount < totalExercises) {
      return res.status(200).json({
        allDone: false,
        doneCount,
        totalExercises,
      });
    }

    // ─── ALL DONE: complete the full day ───────────────────────────────────
    const profile = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
    );

    // Calculate total calories
    let totalCalories = 0;
    for (const entry of completedExercises) {
      const exercise = exercises.find((e) => e.$id === entry.exerciseId);
      if (!exercise) continue;
      const totalSeconds =
        (entry.repsCompleted || 0) * (exercise.avgRepSeconds || 1);
      const durationHours = totalSeconds / 3600;
      totalCalories += exercise.MET * profile.weight * durationHours;
    }

    // Mark session complete
    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_WORKOUT_COLLECTION_ID,
      userId + "_" + today,
      { completed: true, caloriesBurned: totalCalories },
    );

    // Update completed workout days
    const newCompletedDays = (profile.completedWorkoutDays || 0) + 1;
    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
      { completedWorkoutDays: newCompletedDays },
    );

    // Level progression
    let newLevel = profile.currentLevel || "easy";
    if (newCompletedDays >= 30) newLevel = "hard";
    else if (newCompletedDays >= 14) newLevel = "medium";
    if (newLevel !== profile.currentLevel) {
      await databases.updateDocument(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_PROFILE_COLLECTION_ID,
        userId,
        { currentLevel: newLevel },
      );
    }

    // Calorie target recalculation
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
      { BMR, TDEE, dailyCalorieTarget: dailyTarget },
    );

    // Streak update
    const streakDoc = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
    );
    const yesterdayStr = getISTDateString(-1);
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

    // Daily summary
    const { updateDailySummary } = require("../utils/dailySummaryEngine");
    await updateDailySummary(userId);

    return res.status(200).json({
      allDone: true,
      caloriesBurned: totalCalories,
      completedWorkoutDays: newCompletedDays,
      currentStreak: newStreak,
      newLevel,
    });
  } catch (error) {
    console.error("COMPLETE_EXERCISE ERROR:", error);
    res.status(400).json({ error: error.message });
  }
};
