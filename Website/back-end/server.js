#!/usr/bin/env node

//  SERVER TITLE
//  Author:  AUTHORS NAMES
//  Description:  WHAT DOES THIS PACKAGE DO
//  Version: 0.0.1
//
//  Notes:   Any notes we need to know about the server     

//  Install Instructions
//      npm install moment mysql express ejs ....  
//         OR Groups will get more credit if they use
//      npm install and npm start shortcuts and include a package.json file
//          - See https://docs.npmjs.com/creating-a-package-json-file

// Website/back-end/server.js
const path = require('path');
const express = require('express');
const app = express();

app.use(express.static(path.join(__dirname, '../front-end')));
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '../front-end/homepage/index.html'))
);

app.listen(3000, () => console.log('http://localhost:3000'));
