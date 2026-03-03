const express = require("express");
const router = express.Router();
const workoutController = require("../controllers/workout.controller");
const { verifyToken } = require("../middleware/auth.middleware");

router.get("/today", verifyToken, workoutController.getTodayWorkout);
router.post("/complete", verifyToken, workoutController.completeWorkout);

module.exports = router;