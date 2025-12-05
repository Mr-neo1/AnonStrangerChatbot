# Use an official lightweight Node.js image.
FROM node:18-alpine

# Set the working directory.
WORKDIR /app

# Set NODE_ENV to production
ENV NODE_ENV=production

# Copy package files and install production dependencies.
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the application code.
COPY . .

# (Optional) Expose a port if your bot requires it.
# EXPOSE 3000

# Start the bot.
CMD ["npm", "start"]
