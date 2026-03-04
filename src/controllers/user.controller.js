//user.controller.js
const { databases } = require("../config/appwrite");

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.userId;

    const {
      age,
      height,
      weight,
      gender,
      goal,
      level,
      planDuration,
      hasDumbbell,
      hasBackPain,
      hasKneePain,
      phone,
      name,
      avatarUrl,
    } = req.body;

    const BMR =
      weight && height && age && gender
        ? gender === "male"
          ? 10 * weight + 6.25 * height - 5 * age + 5
          : 10 * weight + 6.25 * height - 5 * age - 161
        : null;

    const updatedDoc = await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
      {
        age,
        height,
        weight,
        gender,
        BMR,
        goal,
        level,
        planDuration,
        hasDumbbell,
        hasBackPain,
        hasKneePain,
        phone,
        name,
        avatarUrl,
      },
    );

    res.status(200).json({
      message: "Profile updated successfully",
      data: updatedDoc,
    });
  } catch (error) {
    console.error("PROFILE UPDATE ERROR:", error);
    res.status(400).json({
      error: error.message,
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const document = await databases.getDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId
    );
    res.status(200).json(document);
  } catch (error) {
    console.error("GET PROFILE ERROR:", error);
    res.status(400).json({ error: error.message });
  }
};
