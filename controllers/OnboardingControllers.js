const pool = require('../lib/pool');

const UserOnboarding = async (req, res) => {

    try {
       const {id , email , user_metadata} = req.user;
       
       const authProvider = user_metadata?.provider||'email';
       console.log(id , email , user_metadata);
       const {data , error} = await pool.query('INSERT INTO users (id , email , authProvider) VALUES ($1 , $2 , $3) RETURNING *', [id , email , authProvider]);
       if (error) throw error;
       return res.status(200).json({ message: 'User onboarded successfully' });
    } catch (error) {
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}


module.exports = UserOnboarding;