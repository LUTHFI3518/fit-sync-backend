const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken } = require("../middleware/auth.middleware");

router.post('/register', authController.register);
router.post('/login', authController.login);

// New auth update routes
router.put('/password', verifyToken, authController.updatePassword);
router.put('/email', verifyToken, authController.updateEmail);
router.put('/phone', verifyToken, authController.updatePhone);

module.exports = router;