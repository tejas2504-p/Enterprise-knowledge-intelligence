import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/server.js';
import User from '../src/models/User.js';

describe('API Tests', () => {
  let token;
  const testUser = {
    name: 'Test User',
    email: 'testuser@example.com',
    password: 'password123',
    department: 'Engineering'
  };

  beforeAll(async () => {
    // Wait for mongoose to connect (since it's called in server.js async without await)
    // but we can ensure it's connected or we use a separate test db
    // Just clear the test user if it exists
    if (mongoose.connection.readyState === 1) {
      await User.deleteOne({ email: testUser.email });
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await User.deleteOne({ email: testUser.email });
      await mongoose.disconnect();
    }
  });

  it('GET /api/health should return health status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('success');
  });

  it('POST /api/auth/register should register a user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testUser);
    
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.email).toEqual(testUser.email);
  });

  it('POST /api/auth/login should login the user and set cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password
      });
    
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('_id');
    expect(res.headers['set-cookie']).toBeDefined();
    
    // Extract token for next test
    token = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('GET /api/auth/me should return user profile when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`jwt=${token}`]);
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.email).toEqual(testUser.email);
  });

  it('GET /api/auth/me should fail when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toEqual(401);
  });
});
