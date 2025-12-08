import React, { useState } from 'react'
import '../CartStyles/Shipping.css'
import PageTitle from '../components/PageTitle'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'
import CheckoutPath from './CheckoutPath'
import { useDispatch, useSelector } from 'react-redux'
import {Country, State, City} from 'country-state-city'

function Shipping() {
    const {shippingInfo} = useSelector(state => state.cart)

    const dispatch = useDispatch();
    const [address, setAddress] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [country, setCountry] = useState('');
    const [state, setState] = useState('');
    const [city, setCity] = useState('');

    const shippingInfoSubmit = (e) => {
        e.preventDefault();
    }
    
  return (
    <>
    <PageTitle title='Shipping Info'/>
    <Navbar />

    <CheckoutPath activePath={0}/>
    <div className="shipping-form-container">
        <h1 className="shipping-form-header">
            Shipping Details
        </h1>
        <form className="shipping-form" onSubmit={shippingInfoSubmit}>
            <div className="shipping-section">

                <div className="shipping-form-group">
                    <label 
                    htmlFor="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}>
                        Address
                    </label>
                    <input type="text" 
                    id='address'
                    name='address'
                    placeholder='Enter your Address'/>
                </div>

                <div className="shipping-form-group">
                    <label 
                    htmlFor="pinCode"
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value)}>
                        Zipcode
                    </label>
                    <input type="number" 
                    id='pinCode'
                    name='pinCode'
                    placeholder='Enter your Zipcode'/>
                </div>

                <div className="shipping-form-group">
                    <label 
                    htmlFor="phoneNumber"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}>
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
                    <label 
                    htmlFor="country"
                    value={country}
                    onChange={(e) => 
                    {
                        setCountry(e.target.value)
                        setState('');
                        setCity('');
                    }}>
                        Country
                    </label>
                    <select name="country" id="country" value={country}>
                        <option value="">
                            Select a Country
                        </option>
                        {Country && Country.getAllCountries().map((item) => (
                            <option 
                            value={item.isoCode}
                            key={item.isoCode}>
                                {item.name}
                            </option>
                            )) }
                    </select>
                </div>

                { country && 
                <div className="shipping-form-group">
                    <label 
                    htmlFor="state"
                    value={state}
                    onChange={(e) => 
                    {
                        setState(e.target.value)
                        setCity('');
                    }}>
                        State
                    </label>
                    <select name="state" id="state" value={state}>
                        <option value="">
                            Select your State
                        </option>
                        {State && State.getStatesOfCountry(country).map((item) => (
                            <option 
                            value={item.isoCode}
                            key={item.isoCode}>
                                {item.name}
                            </option>
                            )) }
                    </select>
                </div>}

                { state && 
                <div className="shipping-form-group">
                    <label 
                    htmlFor="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}>
                        City
                    </label>
                    <select name="city" id="city" value={city}>
                        <option value="">
                            Select your City
                        </option>
                        {City && City.getCitiesOfState(country, state).map((item) => (
                            <option 
                            value={item.name}
                            key={item.name}>
                                {item.name}
                            </option>
                            )) }
                    </select>
                </div>}

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