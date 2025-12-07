import React from 'react'
import '../CartStyles/Shipping.css'
import PageTitle from '../components/PageTitle'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'
import CheckoutPath from './CheckoutPath'

function Shipping() {
    
  return (
    <>
    <PageTitle title='Shipping Info'/>
    <Navbar />

    <CheckoutPath activePath={0}/>
    <div className="shipping-form-container">
        <h1 className="shipping-form-header">
            Shipping Details
        </h1>
        <form className="shipping-form">
            <div className="shipping-section">

                <div className="shipping-form-group">
                    <label htmlFor="address">
                        Address
                    </label>
                    <input type="text" 
                    id='address'
                    name='address'
                    placeholder='Enter your Address'/>
                </div>

                <div className="shipping-form-group">
                    <label htmlFor="pinCode">
                        Zipcode
                    </label>
                    <input type="number" 
                    id='pinCode'
                    name='pinCode'
                    placeholder='Enter your Zipcode'/>
                </div>

                <div className="shipping-form-group">
                    <label htmlFor="phoneNumber">
                        Phone Number
                    </label>
                    <input type="tel" 
                    id='phoneNumber'
                    name='phoneNumber'
                    placeholder='Enter your Phone Number'/>
                </div>

            </div>

            <div className="shipping-section">

                <div className="shipping-form-group">
                    <label htmlFor="country">
                        Country
                    </label>
                    <select name="country" id="country">
                        <option value="">
                            Select a Country
                        </option>
                        <option value="us">
                            United State
                        </option>
                        <option value="9ja">
                            Nigeria
                        </option>
                    </select>
                </div>

                <div className="shipping-form-group">
                    <label htmlFor="state">
                        State
                    </label>
                    <select name="state" id="state">
                        <option value="">
                            Select your State
                        </option>
                    </select>
                </div>

                <div className="shipping-form-group">
                    <label htmlFor="city">
                        City
                    </label>
                    <select name="city" id="city">
                        <option value="">
                            Select your City
                        </option>
                    </select>
                </div>

            </div>
            <button className="shipping-submit-btn">
                Continue
            </button>
        </form>
    </div>

    <Footer />
    </>
  )
}

export default Shipping