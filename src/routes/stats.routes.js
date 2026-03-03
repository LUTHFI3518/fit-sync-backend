const express = require("express");
const router = express.Router();
const stats = require("../controllers/stats.controller");
const { verifyToken } = require("../middleware/auth.middleware");

router.get("/daily", verifyToken, stats.getDailyStats);
router.get("/weekly", verifyToken, stats.getWeeklyStats);
router.get("/monthly", verifyToken, stats.getMonthlyStats);
router.get("/lifetime", verifyToken, stats.getLifetimeStats);

module.exports = router;
