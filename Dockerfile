FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Copy all source files (including the src directory and config files)
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
