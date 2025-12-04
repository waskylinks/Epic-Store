import React, { useState } from 'react'
import '../UserStyles/Form.css'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'
import PageTitle from '../components/PageTitle'

function UpdatePassword() {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const updatePasswordSubmit = (e) => {
        e.preventDefault();
        const myForm = new FormData();
                myForm.set('oldPassword', oldPassword)
                myForm.set('newPassword', newPassword)
                myForm.set('confirmPassword', confirmPassword)
    }

  return (
    <>
    <Navbar />
    <PageTitle title='Update Password '/>
    
    <div className="container update-container">
        <div className="form-content">
            <form  
            className="form" 
            
            onSubmit={updatePasswordSubmit} >

                <h2>
                    Update Password
                </h2>

                <div className="input-group">
                    <input 
                    type="password" 
                    name='oldPassword'
                    placeholder='Old Password'
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}/>
                </div>

                <div className="input-group">
                    <input 
                    type="password" 
                    name='newPassword'
                    placeholder='NewPassword'
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}/>
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
                    Update Password
                </button>

            </form>
        </div>
    </div>

    <Footer />
    </>
  )
}

export default UpdatePassword