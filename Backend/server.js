import app from './app.js';
import dotenv from 'dotenv';
import connectDB from './Database/database.js';


// Connect to the database
connectDB();



dotenv.config('config/config.env');
const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
    console.log(`Server is listening on PORT ${PORT}`)
})
