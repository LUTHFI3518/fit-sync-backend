require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const workoutRoutes = require("./routes/workout.routes");
const foodRoutes = require("./routes/food.routes");
const aiRoutes = require("./routes/ai.routes");
const statsRoute = require("./routes/stats.routes");
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/workout", workoutRoutes);
app.use("/api/food", foodRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/stats", statsRoute);

app.get("/", (req, res) => {
  res.send("FitSync Backend Running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
