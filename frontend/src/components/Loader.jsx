import React from 'react';
import '../componentStyles/Loader.css';

function Loader({ type = 'classic', size = 'md' }) {
  return (
    <div className="loader-container">

      {type === 'classic' && (
        <div className="dots-loader-classic">
          <div></div>
          <div></div>
          <div></div>
        </div>
      )}

      {type === 'premium' && (
        <div className="dots-loader-premium">
          <div></div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      )}

      {type === 'snake' && (
        <svg
          className={`snake-loader snake-loader--${size}`}
          viewBox="0 0 50 50"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Loading"
          role="status"
        >
          <circle
            className="snake-loader__track"
            cx="25" cy="25" r="20"
            fill="none"
            strokeWidth="4"
          />
          <circle
            className="snake-loader__arc"
            cx="25" cy="25" r="20"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      )}

    </div>
  );
}

export default Loader;