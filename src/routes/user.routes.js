const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const { verifyToken } = require("../middleware/auth.middleware");

router.put("/profile", verifyToken, userController.updateProfile);

module.exports = router;