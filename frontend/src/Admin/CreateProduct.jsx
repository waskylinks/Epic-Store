import React, { useState } from 'react'
import PageTitle from '../components/PageTitle'
import '../AdminStyles/CreateProduct.css'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'

function CreateProduct() {
    const [name, setName] = useState('');
  return (
    <>
    <PageTitle title='Create Product'/>
    <Navbar />

    <div className="create-product-container">
        <h1 className="form-title">
            Create Product
        </h1>
        <form 
        className="product-form"
        encType='multipart/form-data'>
            <input 
            type="text" 
            className="form-input" 
            placeholder='Enter Product Name' 
            required
            name='name'/>

            <input 
            type="number" 
            className="form-input" 
            placeholder='Enter Product Price' 
            required
            name='price'/>

            <input 
            type="text" 
            className="form-input" 
            placeholder='Enter Product Description' 
            required
            name='description'/>

            <select className="form-select" name='category'>
                <option value="">Choose Category</option>
                <option value="mobile" key='1' required >Mobile</option>
            </select>

            <input 
            type="number" 
            className="form-input" 
            placeholder='Enter Product Stock' 
            required
            name='stock'/>

            <div className="file-input-container">
                <input 
                type="file" 
                className="form-input-file" 
                accept='image/'
                multiple 
                name='image'/>
            </div>

            <div className="image-preview-container">
                <img src="" alt="Product Preview" className='image-preview' key='1'/>
            </div>

            <button className="submit-btn">
                Create
            </button>
        </form>
    </div>

    <Footer />
    </>
  )
}

export default CreateProduct