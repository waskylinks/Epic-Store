import React, { useState } from 'react'
import '../UserStyles/Form.css'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'

function UpdateProfile() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [avatar, setAvatar] = useState('');
    const [avatarPreview, setAvatarPreview] = useState('./images/profile.webp');

  return (
    <>
    <Navbar />

    <div className="container update-container">
        <div className="form-content">
            <form  className="form">
                <h2>
                    Update Profile
                </h2>

                <div className="input-group avatar-group">
                    <input type="file" className="file-input" accept='image'/>
                    <img src={avatarPreview} alt="User profile" className="avatar" />
                </div>

                <div className="input-group">
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}/>
                </div>

                <div className="input-group">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}/>
                </div>

                <button className="authBtn">
                    Update
                </button>
            </form>
        </div>
    </div>

    <Footer />
    </>
  )
}

export default UpdateProfile