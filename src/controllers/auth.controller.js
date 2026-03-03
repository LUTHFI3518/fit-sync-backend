// auth.controller.js
const { users, databases } = require("../config/appwrite");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ID } = require("appwrite");

exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // 1️⃣ Create Appwrite Auth User
    const user = await users.create(
      ID.unique(),
      email,
      undefined,
      password,
      name,
    );

    const userId = user.$id;

    // 2️⃣ Create Profile Document
    await databases.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId, // SAME ID AS AUTH USER
      {
        userId: userId,
        name: name,
        email: email,
        phone: null,
        age: null,
        height: null,
        BMR: null,
        goal: null,
        level: null,
        planDuration: null,
        hasDumbbell: null,
        hasBackPain: null,
        hasKneePain: null,
        avatarUrl: null,
        weight: null,
        gender: null,
      },
    );

    // 3️⃣ Create Streak Document
    await databases.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STREAK_COLLECTION_ID,
      userId,
      {
        userId: userId,
        currentStreak: 0,
        longestStreak: 0,
        lastWorkoutDate: null,
      },
    );

    // 4️⃣ Generate JWT
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      message: "User registered successfully",
      token,
      userId,
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(400).json({
      error: error.message,
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const session = await users.createSession(email, password);

    const token = jwt.sign({ userId: session.userId }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({
      message: "Login successful",
      token,
      userId: session.userId,
    });
  } catch (error) {
    res.status(401).json({
      error: "Invalid credentials",
    });
  }
};
