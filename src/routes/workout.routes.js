const express = require("express");
const router = express.Router();
const workoutController = require("../controllers/workout.controller");
const { verifyToken } = require("../middleware/auth.middleware");

router.get("/today", verifyToken, workoutController.getTodayWorkout);
router.post("/complete", verifyToken, workoutController.completeWorkout);
router.post(
  "/complete-exercise",
  verifyToken,
  workoutController.completeExercise,
);
router.get("/journey", verifyToken, workoutController.getJourney);
router.get("/exercise-info/:name", verifyToken, workoutController.getExerciseInfo);

module.exports = router;
