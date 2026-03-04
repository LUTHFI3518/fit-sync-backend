// auth.controller.js
const { users, databases } = require("../config/appwrite");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ID } = require("appwrite");
const sdk = require("node-appwrite");

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

    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID);

    const account = new sdk.Account(client);

    const session = await account.createEmailPasswordSession(email, password);

    const token = jwt.sign({ userId: session.userId }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({
      message: "Login successful",
      token,
      userId: session.userId,
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(401).json({
      error: "Invalid credentials",
    });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const userId = req.userId;
    const { oldPassword, newPassword } = req.body;

    const user = await users.get(userId);

    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID);
    const account = new sdk.Account(client);

    // Verify old password
    try {
      await account.createEmailPasswordSession(user.email, oldPassword);
    } catch(err) {
      return res.status(401).json({ error: "Incorrect current password" });
    }

    // Update password
    await users.updatePassword(userId, newPassword);

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("UPDATE PASSWORD ERROR:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.updateEmail = async (req, res) => {
  try {
    const userId = req.userId;
    const { newEmail, password } = req.body;

    const user = await users.get(userId);

    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID);
    const account = new sdk.Account(client);

    // Verify password
    try {
      await account.createEmailPasswordSession(user.email, password);
    } catch(err) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    // Update Auth User Email
    await users.updateEmail(userId, newEmail);

    // Update Profile Document Email
    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
      { email: newEmail }
    );

    res.status(200).json({ message: "Email updated successfully" });
  } catch (error) {
    console.error("UPDATE EMAIL ERROR:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.updatePhone = async (req, res) => {
  try {
    const userId = req.userId;
    const { newPhone } = req.body; // Appwrite requires format +123456789

    // We assume newPhone is passed with international code, e.g., +1234567890
    // If not, it will throw an error. Add '+' if missing?
    let phoneStr = newPhone;
    if (phoneStr && !phoneStr.startsWith('+')) {
      // Just prepending + to try to satisfy Appwrite, though they should provide country code.
      phoneStr = '+' + phoneStr;
    }

    await users.updatePhone(userId, phoneStr);

    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_PROFILE_COLLECTION_ID,
      userId,
      { phone: phoneStr }
    );

    res.status(200).json({ message: "Phone number updated successfully" });
  } catch (error) {
    console.error("UPDATE PHONE ERROR:", error);
    // If phone number is invalid, it throws 400
    res.status(400).json({ error: error.message });
  }
};

