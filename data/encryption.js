const bcrypt = require('bcrypt');


const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(password), salt);
    return hashedPassword;
}

const verifyPassword = async (password, hashedPassword) => {
    const isMatch = await bcrypt.compare(String(password), hashedPassword);
    return isMatch;
}

module.exports = { hashPassword, verifyPassword };