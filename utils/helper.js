module.exports = {
  isValidAge: (age) => {
    const num = parseInt(age, 10);
    return !isNaN(num) && num > 0 && num < 120;
  },
};
