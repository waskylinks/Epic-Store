import React from 'react';
import '../componentStyles/Loader.css';

function Loader({ type = 'classic' }) {
  return (
    <div className="loader-container">
      {type === 'classic' ? (
        <div className="dots-loader-classic">
          <div></div>
          <div></div>
          <div></div>
        </div>
      ) : (
        <div className="dots-loader-premium">
          <div></div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      )}
    </div>
  );
}

export default Loader;
