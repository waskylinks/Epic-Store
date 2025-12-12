import React, { useState } from 'react';
import '../CartStyles/Shipping.css';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import CheckoutPath from './CheckoutPath';
import { useDispatch, useSelector } from 'react-redux';
import { Country, State, City } from 'country-state-city';
import { toast } from 'react-toastify';
import { saveShippingInfo } from '../features/cart/cartSlice';
import { useNavigate } from 'react-router-dom';

function Shipping() {
    const { shippingInfo } = useSelector(state => state.cart);

    const [address, setAddress] = useState(shippingInfo.address || '');
    const [pinCode, setPinCode] = useState(shippingInfo.pinCode || '');
    const [phoneNo, setPhoneNo] = useState(shippingInfo.phoneNo || '');
    const [country, setCountry] = useState(shippingInfo.country || '');
    const [state, setState] = useState(shippingInfo.state || '');
    const [city, setCity] = useState(shippingInfo.city || '');

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const shippingInfoSubmit = (e) => {
        e.preventDefault();

        // Phone number validation
        const phoneRegex = /^[0-9]{11}$/;
        if (!phoneRegex.test(phoneNo)) {
            toast.error('Invalid phone number', { position: 'top-center', autoClose: 2000 });
            return;
        }

        // Zip code validation
        if (!pinCode || pinCode.toString().length < 4) {
            toast.error('Invalid Zipcode', { position: 'top-center', autoClose: 2000 });
            return;
        }

        // Dispatch shipping info to Redux
        dispatch(saveShippingInfo({
            address,
            pinCode: pinCode.toString(),
            phoneNo,        // matches backend field
            country,
            state,
            city
        }));

        navigate('/order/confirm');
    };

    return (
        <>
            <PageTitle title='Shipping Info' />
            <Navbar />
            <CheckoutPath activePath={0} />

            <div className="shipping-form-container">
                <h1 className="shipping-form-header">Shipping Details</h1>
                <form className="shipping-form" onSubmit={shippingInfoSubmit}>

                    <div className="shipping-section">
                        <div className="shipping-form-group">
                            <label htmlFor="address">Address</label>
                            <input
                                type="text"
                                id='address'
                                name='address'
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder='Enter your Address'
                                required
                            />
                        </div>

                        <div className="shipping-form-group">
                            <label htmlFor="pinCode">Zipcode</label>
                            <input
                                type="number"
                                id='pinCode'
                                name='pinCode'
                                value={pinCode}
                                onChange={(e) => setPinCode(e.target.value)}
                                placeholder='Enter your Zipcode'
                                required
                            />
                        </div>

                        <div className="shipping-form-group">
                            <label htmlFor="phoneNo">Phone Number</label>
                            <input
                                type="tel"
                                id='phoneNo'
                                name='phoneNo'
                                value={phoneNo}
                                onChange={(e) => setPhoneNo(e.target.value)}
                                placeholder='Enter your Phone Number'
                                required
                            />
                        </div>
                    </div>

                    <div className="shipping-section">
                        <div className="shipping-form-group">
                            <label htmlFor="country">Country</label>
                            <select
                                name="country"
                                id="country"
                                value={country}
                                onChange={(e) => {
                                    setCountry(e.target.value);
                                    setState('');
                                    setCity('');
                                }}
                                required
                            >
                                <option value="">Select a Country</option>
                                {Country.getAllCountries().map(item => (
                                    <option value={item.isoCode} key={item.isoCode}>{item.name}</option>
                                ))}
                            </select>
                        </div>

                        {country && (
                            <div className="shipping-form-group">
                                <label htmlFor="state">State</label>
                                <select
                                    name="state"
                                    id="state"
                                    value={state}
                                    onChange={(e) => { setState(e.target.value); setCity(''); }}
                                    required
                                >
                                    <option value="">Select your State</option>
                                    {State.getStatesOfCountry(country).map(item => (
                                        <option value={item.isoCode} key={item.isoCode}>{item.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {state && (
                            <div className="shipping-form-group">
                                <label htmlFor="city">City</label>
                                <select
                                    name="city"
                                    id="city"
                                    value={city}
                                    onChange={(e) => setCity(e.target.value)}
                                    required
                                >
                                    <option value="">Select your City</option>
                                    {City.getCitiesOfState(country, state).map(item => (
                                        <option value={item.name} key={item.name}>{item.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <button type="submit" className="shipping-submit-btn">Continue</button>
                </form>
            </div>

            <Footer />
        </>
    );
}

export default Shipping;
