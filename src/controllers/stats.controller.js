const { databases } = require("../config/appwrite");
const { Query } = require("appwrite");

exports.getDailyStats = async (req, res) => {
  try {
    const userId = req.userId;
    const date = req.query.date || new Date().toISOString().split("T")[0];

    const result = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_DAILY_COLLECTION_ID,
      [Query.equal("userId", userId), Query.equal("date", date)],
    );

    if (result.total === 0) {
      return res.status(200).json({});
    }

    return res.status(200).json(result.documents[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getWeeklyStats = async (req, res) => {
  try {
    const userId = req.userId;

    const today = new Date();
    const last7 = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      last7.push(d.toISOString().split("T")[0]);
    }

    const result = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_DAILY_COLLECTION_ID,
      [
        Query.equal("userId", userId),
        Query.greaterThanEqual("date", last7[0]),
        Query.lessThanEqual("date", last7[6]),
      ],
    );

    const map = {};
    result.documents.forEach((doc) => {
      map[doc.date] = doc.intakeCalories;
    });

    const response = last7.map((date) => ({
      date,
      intake: map[date] || 0,
    }));

    res.status(200).json(response);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getMonthlyStats = async (req, res) => {
  try {
    const userId = req.userId;
    const today = new Date();

    const start = new Date();
    start.setDate(today.getDate() - 27);

    const startStr = start.toISOString().split("T")[0];
    const endStr = today.toISOString().split("T")[0];

    const result = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_DAILY_COLLECTION_ID,
      [
        Query.equal("userId", userId),
        Query.greaterThanEqual("date", startStr),
        Query.lessThanEqual("date", endStr),
      ],
    );

    const weeks = [0, 0, 0, 0];

    result.documents.forEach((doc) => {
      const diff = (new Date(doc.date) - start) / (1000 * 60 * 60 * 24);
      const weekIndex = Math.floor(diff / 7);

      if (weekIndex >= 0 && weekIndex < 4) {
        weeks[weekIndex] += doc.intakeCalories;
      }
    });

    const response = weeks.map((intake, index) => ({
      week: index + 1,
      intake,
    }));

    res.status(200).json(response);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getLifetimeStats = async (req, res) => {
  try {
    const userId = req.userId;

    const result = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_DAILY_COLLECTION_ID,
      [Query.equal("userId", userId)],
    );

    let totalIntake = 0;
    let totalBurned = 0;
    let totalDays = result.total;

    result.documents.forEach((doc) => {
      totalIntake += doc.intakeCalories;
      totalBurned += doc.burnedCalories;
    });

    res.status(200).json({
      lifetimeIntake: totalIntake,
      lifetimeBurned: totalBurned,
      totalTrackedDays: totalDays,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
