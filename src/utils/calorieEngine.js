exports.calculateBMR = (profile) => {
  const { weight, height, age, gender } = profile;

  if (!weight || !height || !age) return 0;

  if (gender === "female") {
    return 10 * weight + 6.25 * height - 5 * age - 161;
  }

  return 10 * weight + 6.25 * height - 5 * age + 5;
};

exports.calculateTDEE = (BMR, level) => {
  const factors = {
    easy: 1.2,
    medium: 1.55,
    hard: 1.725,
  };

  return BMR * (factors[level] || 1.2);
};

exports.calculateTarget = (TDEE, goal) => {
  if (goal === "Lose weight") return TDEE - 500;
  if (goal === "Build muscle") return TDEE + 300;
  return TDEE;
};
