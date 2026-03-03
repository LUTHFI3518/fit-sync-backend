const express = require("express");
const router = express.Router();
const foodController = require("../controllers/food.controller");
const { verifyToken } = require("../middleware/auth.middleware");

router.post("/log", verifyToken, foodController.logFood);

module.exports = router;