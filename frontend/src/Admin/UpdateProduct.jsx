import React, { useState } from 'react'
import '../AdminStyles/UpdateProduct.css'
import PageTitle from '../components/PageTitle'
import Navbar from '../components/Navbar'
import Footer from '../components/footer'

function UpdateProduct() {
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [description, setDescription] = useState('');
    const [stock, setStock] = useState('');
    const [category, setCategory] = useState('');
    const [oldImage, setOldImage] = useState([]);
    const [imagePreview, setImagePreview] = useState([]);

    const categories = ['Trousers', 'Shirts', 'Shoes', 'Jackets'];

  return (

    <>
    <PageTitle title='Update Product' />
    <Navbar />

    <div className="update-product-wrapper">
        <h1 className="update-product-ti">
            Update Product
        </h1>
        <form 
        className="update-product-form"
        encType='multipart/form-data'
        >
            <label htmlFor="name">
                Product Name
            </label>
            <input 
            type="text" 
            className='update-product-input'
            required
            id='name'
            name='name'
            value={name}
            onChange={(e) => setName(e.target.value)}
             />

             <label htmlFor="price">
                Product Price
            </label>
            <input 
            type="Number" 
            className='update-product-input'
            required
            id='price'
            name='price'
            value={price}
            onChange={(e) => setPrice(e.target.value)}
             />

             <label htmlFor="description">
                Product Description
            </label>
            <textarea
            type="text" 
            className='update-product-textarea'
            required
            id='description'
            name='description'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
             />

             <label htmlFor="category">
                Product Category
            </label>
            <select
            id='category'
            name='category'
            className='update-product-select'
            value={category}
            onChange={(e) => setCategory(e.target.value)}
             >
                <option value="">Choose Category</option>
                    {categories.map((item) => (
                        <option key={item} value={item}>
                            {item}
                        </option>
                    ))}
             </select>
             
             <label htmlFor="stock">
                Product Stock
            </label>
            <input 
            type="number" 
            className='update-product-input'
            required
            id='stock'
            name='stock'
            value={stock}
            onChange={(e) => setStock(e.target.value)}
             />

             <label htmlFor="image">
                Product Images
             </label>
             <div className="update-product-file-wrapper">
                <input 
                type="file" 
                accept='image/*'
                name='image'
                multiple
                className='update-product-file-input'
                />
             </div>
             <div className="update-product-preview-wrapper">
                { imagePreview.map((img, index) => (
                    <img 
                src={img}
                alt={`Preview ${index + 1}`}
                className="update-product-preview-image"
                key={index}
                />
                ))}
             </div>

             <div className="update-product-old-images-wrapper">
                { oldImage.map((img, index) => (
                    <img 
                src={img.url}
                alt={`Preview ${index}`}
                className='update-product-old-image'
                key={index}
                />
                ))}

             </div>
             <button className="update-product-submit-btn">
                Update
             </button>
        </form>
    </div>

    <Footer />
    </>
  )
}

export default UpdateProduct