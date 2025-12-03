import React from 'react'
import '../UserStyles/Profile.css'
import { Link } from 'react-router-dom'

function Profile() {
  return (
    <div className="profile-container">
        <div className="profile-image">
            <h1 className="profile-heading">
                My Profile
            </h1>
            <img src="" alt="User profile" className='profile-image'/>
            <Link to='/profile/update'>Edit Profile</Link>
        </div>

        <div className="profile-details">
            <div className="profile-detail">
                <h2>Username:</h2>
                <p>Pac</p>
            </div>
            <div className="profile-detail">
                <h2>Email:</h2>
                <p>Pac@gmail.com</p>
            </div>
            <div className="profile-detail">
                <h2>Joined On:</h2>
                <p>Jan 1 2025</p>
            </div>
        </div>
    </div>
  )
}

export default Profile