exports.aiTools = [
  {
    type: "function",
    function: {
      name: "log_food",
      description: "Log food intake for the user",
      parameters: {
        type: "object",
        properties: {
          foodName: { type: "string" },
          calories: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fats: { type: "number" },
          mealType: {
            type: "string",
            enum: ["breakfast", "lunch", "dinner"]
          }
        },
        required: ["foodName", "calories"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_daily_summary",
      description: "Get today's calorie balance summary",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_today_workout",
      description: "Get today's workout session for the user",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "pause_workout",
      description: "Pause workouts for illness or recovery",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "resume_workout",
      description: "Resume workouts after pause",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "break_streak",
      description: "Break user's workout streak due to absence",
      parameters: { type: "object", properties: {} }
    }
  }
];