import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  let token;

  // Read JWT from Authorization header (Bearer token) or 'jwt' cookie
  if (req.headers?.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');

      // Get user from token, exclude password
      req.user = await User.findById(decoded.userId).select('-password');

      if (!req.user) {
        res.status(401);
        throw new Error('Not authorized, user not found');
      }

      if (!req.user.isActive) {
        res.status(401);
        throw new Error('Not authorized, account is inactive');
      }

      next();
    } catch (error) {
      console.error('Auth verification error:', error.message);
      res.status(401);
      next(new Error(error.message === 'Not authorized, account is inactive' ? error.message : 'Not authorized, token failed'));
    }
  } else {
    res.status(401);
    next(new Error('Not authorized, no token'));
  }
};

export const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403);
    next(new Error('Not authorized as an admin'));
  }
};
