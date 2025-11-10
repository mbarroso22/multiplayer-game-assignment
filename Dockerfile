FROM node:18

# Create app directory
WORKDIR /usr/src/mc_app

# Install app dependencies
COPY package*.json ./
RUN npm install

# RUN npm install express socket.io uuid

# Copy app source code
COPY . .

# Expose the port the app runs on
EXPOSE 3003

# Start the app
CMD ["npm", "start"]