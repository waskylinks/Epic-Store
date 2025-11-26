import React, { useState } from 'react'
import '../componentStyles/Rating.css'
import { FaStar, FaRegStar } from "react-icons/fa";

function Rating({ value, onRatingChange, disabled }) {
    const [hoverRating, setHoverRating] = useState(0);
    const [selectedRating, setSelectedRating] = useState(value || 0);

    const handleMouseEnter = (rating) => {
        if (!disabled) {
            setHoverRating(rating);
        }
    };

    const handleMouseLeave = () => {
        if (!disabled) {
            setHoverRating(0);
        }
    };

    const handleClick = (rating) => {
        if (!disabled) {
            setSelectedRating(rating);
            if (onRatingChange) {
                onRatingChange(rating);
            }
        }
    };

    const generateStars = () => {
        const stars = [];
        for (let i = 1; i <= 5; i++) {
            const isFilled = i <= (hoverRating || selectedRating);

            stars.push(
                <span
                    className={`star ${isFilled ? 'filled' : ''}`}
                    key={i}
                    onMouseEnter={() => handleMouseEnter(i)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleClick(i)}
                    style={{ pointerEvents: disabled ? 'none' : 'auto' }}
                >
                    {isFilled ? <FaStar /> : <FaRegStar />}
                </span>
            );
        }
        return stars;
    };

    return (
        <div>
            <div className="rating">
                {generateStars()}
            </div>
        </div>
    );
}

export default Rating;
