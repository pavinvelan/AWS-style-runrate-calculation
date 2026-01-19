# Use official Node.js LTS image as base
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Expose the application port
EXPOSE 3000

# Set environment variables (can be overridden at runtime)
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/dashboard.html', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["npm", "run", "server"]
