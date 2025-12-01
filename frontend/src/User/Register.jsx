import React, { useState } from 'react'
import '../UserStyles/Form.css';
import { Link } from 'react-router-dom';

function Register() {

    const [user, setUser] = useState({
        name: '',
        email: '',
        password: '',
    })
    const {name, email, password} = user

    const [avatar, setAvatar] = useState('');
    const [avatarPreview, setAvatarPreview] = useState('./images/profile.webp')

    const registerDataChange = (e) => {
        if(e.target.name === 'avatar') {
            const reader = new FileReader();
            reader.onload = () => {
                if(reader.readyState === 2) {
                    setAvatarPreview(reader.result)
                    setAvatar(reader.result)
                }
            }
            reader.readAsDataURL(e.target.files[0]);

        } else {
            setUser({
                ...user, 
                [e.target.name]: e.target.value
            })
        }
    }



  return (
    <div className="form-container container">
        <div className="form-content">
            <form className="form">
                <h2>
                    Sign Up
                </h2>
                <div className="input-group">
                    <input type="text" placeholder='Username' name='name' value={name} onChange={registerDataChange}/>
                </div>
                <div className="input-group">
                    <input type="text" placeholder='Email' name='email'value={email} onChange={registerDataChange}/>
                </div>
                <div className="input-group">
                    <input type="password" placeholder='Password' name='password'value={password} onChange={registerDataChange}/>
                </div>
                <div className="input-group avatar-group">
                    <input type="file"  name='avatar'className='file-input' accept='image/' onChange={registerDataChange}/>
                    <img src={avatarPreview} alt="Avatar Preview" className='avatar'/>
                </div>
                <button className="authBtn">
                    Sign Up
                </button>
                <p className="form-links">
                    Already have an account? 
                    <Link to='/login'>Sign in here</Link>
                </p>
            </form>
        </div>
    </div>
  )
}

export default Register