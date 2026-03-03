const { databases } = require("../config/appwrite");
const { updateDailySummary } = require("../utils/dailySummaryEngine");

const getTodayString = () => {
  return new Date().toISOString().split("T")[0];
};

exports.logFood = async (req, res) => {
  try {
    const userId = req.userId;
    const today = getTodayString();

    const { foodName, calories, protein, carbs, fats } = req.body;

    if (!foodName || !calories) {
      return res.status(400).json({
        error: "foodName and calories are required"
      });
    }

    await databases.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_FOOD_COLLECTION_ID,
      "unique()",
      {
        userId,
        date: today,
        foodName,
        calories,
        protein: protein || 0,
        carbs: carbs || 0,
        fats: fats || 0
      }
    );

    const summary = await updateDailySummary(userId);

    res.status(200).json({
      message: "Food logged successfully",
      summary
    });

  } catch (error) {
    console.error("FOOD LOG ERROR:", error);
    res.status(400).json({ error: error.message });
  }
};