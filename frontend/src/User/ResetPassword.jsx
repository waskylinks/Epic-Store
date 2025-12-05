import React, { useState } from 'react'
import '../UserStyles/Form.css'
import PageTitle from '../components/PageTitle'
import { useParams } from 'react-router-dom';

function ResetPassword() {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const {token} = useParams()

    const resetPasswordSubmit = (e) => {
        e.preventDefault();
        const data = {
            password,
            confirmPassword
        }
        console.log(data)
    }

  return (
    <>
    <PageTitle title='Reset Password'/>
    <div className="container update-container">
        <div className="form-content">
            <form  
            className="form" 
            onSubmit={resetPasswordSubmit} >

                <h2>
                    Reset Password
                </h2>

                <div className="input-group">
                    <input 
                    type="password" 
                    name='password'
                    placeholder='Enter New Password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}/>
                </div>

                <div className="input-group">
                    <input 
                    type="password" 
                    name='confirmPassword'
                    placeholder='Confirm Password'
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}/>
                </div>

                <button className="authBtn">
                    Reset Password
                </button>

            </form>
        </div>
    </div>
    </>
  )
}

export default ResetPassword