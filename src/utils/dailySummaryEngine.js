const { databases } = require("../config/appwrite");
const { Query } = require("appwrite");

const getTodayString = () => {
  return new Date().toISOString().split("T")[0];
};

const getStatus = (balance, goal) => {
  if (goal === "Lose weight") {
    if (balance < -700) return "extreme_deficit";
    if (balance <= -300) return "optimal_deficit";
    if (balance < 0) return "mild_deficit";
    return "surplus";
  }

  if (goal === "Build muscle") {
    if (balance < 0) return "deficit";
    if (balance <= 400) return "optimal_surplus";
    if (balance <= 700) return "mild_surplus";
    return "excess_surplus";
  }

  // Stay healthy
  if (balance >= -200 && balance <= 200) return "optimal";
  if (balance < -200) return "deficit";
  return "surplus";
};

exports.updateDailySummary = async (userId) => {
  const today = getTodayString();

  const profile = await databases.getDocument(
    process.env.APPWRITE_DATABASE_ID,
    process.env.APPWRITE_PROFILE_COLLECTION_ID,
    userId,
  );

  const BMR = profile.BMR || 0;
  const goal = profile.goal;

  const workout = await databases.listDocuments(
    process.env.APPWRITE_DATABASE_ID,
    process.env.APPWRITE_WORKOUT_COLLECTION_ID,
    [Query.equal("userId", userId), Query.equal("date", today)],
  );

  const burned =
    workout.total > 0 ? workout.documents[0].caloriesBurned || 0 : 0;

  const foodLogs = await databases.listDocuments(
    process.env.APPWRITE_DATABASE_ID,
    process.env.APPWRITE_FOOD_COLLECTION_ID,
    [Query.equal("userId", userId), Query.equal("date", today)],
  );

  let intake = 0;
  let breakfast = 0;
  let lunch = 0;
  let dinner = 0;
  foodLogs.documents.forEach((food) => {
    intake += food.calories;

    if (food.mealType === "breakfast") breakfast += food.calories;
    if (food.mealType === "lunch") lunch += food.calories;
    if (food.mealType === "dinner") dinner += food.calories;
  });

  const energySpent = BMR + burned;
  const balance = intake - energySpent;
  const status = getStatus(balance, goal);

  const existing = await databases.listDocuments(
    process.env.APPWRITE_DATABASE_ID,
    process.env.APPWRITE_DAILY_COLLECTION_ID,
    [Query.equal("userId", userId), Query.equal("date", today)],
  );

  if (existing.total > 0) {
    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_DAILY_COLLECTION_ID,
      existing.documents[0].$id,
      {
        intakeCalories: intake,
        burnedCalories: burned,
        breakfastCalories: breakfast,
        lunchCalories: lunch,
        dinnerCalories: dinner,
        energySpent,
        balance,
        status,
      },
    );
  } else {
    await databases.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_DAILY_COLLECTION_ID,
      userId + "_" + today,
      {
        userId,
        date: today,
        intakeCalories: intake,
        burnedCalories: burned,
        breakfastCalories: breakfast,
        lunchCalories: lunch,
        dinnerCalories: dinner,
        energySpent,
        balance,
        status,
      },
    );
  }

  return {
    intake,
    breakfast,
    lunch,
    dinner,
    burned,
    energySpent,
    balance,
    status,
  };
};
