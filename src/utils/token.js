import jwt from 'jsonwebtoken';

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set in your environment variables.');
  }
  return secret;
};

// Payload is intentionally minimal — just enough to look the user up again.
// Never put anything sensitive (password hash, etc) in a JWT payload; it's
// base64, not encrypted, and can be read by anyone holding the token.
export const signToken = (userId) => {
  return jwt.sign({ sub: userId }, getSecret(), { expiresIn: '30d' });
};

// Throws if the token is missing, malformed, expired, or signed with a different secret.
export const verifyToken = (token) => {
  const decoded = jwt.verify(token, getSecret());
  return decoded.sub; // the userId
};
