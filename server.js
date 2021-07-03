/*==============================================================================
(C) Copyright 2019,2020,2021 John J Kauflin, All rights reserved. 
-----------------------------------------------------------------------------
DESCRIPTION: NodeJS server to run console utilies for the web site
-----------------------------------------------------------------------------
Modification History
2019-02-11 JJK  Initial version
2020-07-07 JJK  Modified to work with new MediaGallery and createThumbnails
                which takes "subPath" as a parameter
2021-05-09 JJK  Re-factored for MediaGallery-Admin
                Working on FTP functions
2021-05-27 JJK  Re-worked the file loop to get list of only image files
                without the LOCAL ROOT
2021-05-28 JJK  Completed new FTP and create thumbnail logic
2021-07-03 JJK  Added logic to create the remote directory if missing
=============================================================================*/

// General handler for any uncaught exceptions
process.on('uncaughtException', function (e) {
    console.log("UncaughtException, error = " + e);
    console.error(e.stack);
    // Stop the process
    process.exit(1);
});

// Read environment variables from the .env file
require('dotenv').config();

const https = require('https');
var dateTime = require('node-datetime');
var ftp = require('ftp');

// List all files in a directory in Node.js recursively in a synchronous fashion
var fs = require('fs');
var filepath = '';
var extension = '';
var walkSync = function (dir, filelist) {
    files = fs.readdirSync(dir);
    filelist = filelist || [];
    files.forEach(function (file) {
        filepath = dir+'/'+file;
        if (fs.statSync(filepath).isDirectory()) {
            filelist = walkSync(filepath, filelist);
        }
        else {
            // Only add support file types to the list
            extension = file.substring(file.lastIndexOf(".")+1).toUpperCase();
            if (extension == "JPEG" || extension == "JPG" || extension == "PNG" || extension == "GIF") {
                // Add the path minus the LOCAL ROOT
                filelist.push(dir.replace(process.env.LOCAL_PHOTOS_ROOT,'')+'/'+file);
            }
        }
    });
    return filelist;
};
// Start the walkSync to load all the files into the filelist array
var fileList = walkSync(process.env.LOCAL_PHOTOS_ROOT+process.env.PHOTOS_START_DIR);
//for (var i = 0, len = fileList.length; i < len; i++) {
//    console.log("fileList[" + i + "] = " + fileList[i]);
//}

var startTime = '';
var ftpClient = new ftp();
ftpClient.connect({
    host: process.env.FTP_HOST,
    port: process.env.FTP_PORT,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASS
});
ftpClient.on('ready', function () {
    startTime = dateTime.create().format('Y-m-d H:M:S ');
    console.log(dateTime.create().format('Y-m-d H:M:S ') + "FTP connected, start dir = " + process.env.PHOTOS_START_DIR);
    // After the FTP connection is made, start recursive function
    transferFile(0);
});
ftpClient.on('end', function () {
    console.log(dateTime.create().format('Y-m-d H:M:S ') + "FTP ended, start time = "+startTime);
});

var tempStr = '';
function transferFile(index) {
    var localFileNameAndPath = process.env.LOCAL_PHOTOS_ROOT + fileList[index];
    var fileNameAndPath = process.env.REMOTE_PHOTOS_ROOT + fileList[index];
    //console.log(">>> "+dateTime.create().format('Y-m-d H:M:S ') + (index+1) + " of " + fileList.length + ", " + fileList[index]);

    // First try to get the last modified information for the file
    ftpClient.lastMod(fileNameAndPath, function (error, lastModified) {
        if (error) {
            //console.log("err in lastMod, err = "+error);
            // If there was an error, see if it is because of No file or directory
            tempStr = String(error);
            if (tempStr.indexOf('No such file or directory') !== -1) {
                // If No file or directory, try a PUT of the file
                ftpClient.put(localFileNameAndPath, fileNameAndPath, function (err2) {
                    if (err2) {
                        // Check if the PUT error was because of No directory
                        tempStr = String(err2);
                        if (tempStr.indexOf('No such file or directory') !== -1) {
                            // If PUT error was because of No file or directory, try creating the directory and re-try the file transfer
                            tempStr = fileNameAndPath.substring(0, fileNameAndPath.lastIndexOf("/"));
                            ftpClient.mkdir(tempStr, function (err3) {
                                if (err3) {
                                    console.log("Error in mkdir, directory = "+tempStr);
                                    console.log("err3 = "+err3);
                                    ftpClient.end();
                                    throw err2;
                                }

                                console.log("Directory created, dir = "+tempStr);
                                // If the create dir was successful, re-try the transfer
                                //console.log(">>> calling the transferFile, index = "+index);
                                setTimeout(transferFile, 10, index);
                            });

                        } else {
                            // Some other error
                            console.log("Some other error in PUT besides No file or directory, err2 = "+err2);
                            ftpClient.end();
                            throw err2;
                        }
                    } else {
                        // If the FTP PUT was successful, do the create thumbnail and go to next file
                        console.log(dateTime.create().format('Y-m-d H:M:S ') + (index+1) + " of " + fileList.length + ", " + fileList[index] + ", Transferred");
                        // Proceed to creating the thumbnail after a small delay
                        setTimeout(createThumbnail, 10, index);
                    }
                });

            } else {
                console.log("Some other ERROR in get Last Modified besides No file or directory, err = "+error);
                ftpClient.end();
                throw error;
            }
        } else {
            // If get of Last Modified was success, then the file was already there (transferred and assume thumbnails created)
            //console.log("lastModified = "+lastModified);
            // lastModified = Sat Apr 10 2021 12:54:30 GMT-0400 (Eastern Daylight Time)
            
            // >>>>> Uncomment if you want to see progress
            //console.log(dateTime.create().format('Y-m-d H:M:S ') + (index+1) + " of " + fileList.length + ", " + fileList[index] + ", Exists");
            
            // if File found, just proceed to the next file
            if (index < fileList.length - 1) {
                // Proceed to the next file after a short delay
                setTimeout(transferFile, 10, index + 1);
            } else {
                ftpClient.end();
            }
        }
    });

    /*
    ftpClient.list(process.env.REMOTE_PATH, false, function (error, dirlist) {
        console.log("dirlist len = " + dirlist.length);
        dirlist.forEach(function (dl) {
            console.log("name = " + dl.name);
        });
    });
    */

} // function transferFile(index) {


function createThumbnail(index) {
    var fileNameAndPath = fileList[index];
    var tempUrl = process.env.WEB_ROOT_URL + '/vendor/jkauflin/jjkgallery/createThumbnail.php?filePath=' + fileNameAndPath;
    //console.log("tempUrl = " + tempUrl);

    https.get(tempUrl, (resp) => {
        let data = '';
        // A chunk of data has been recieved.
        resp.on('data', (chunk) => {
            data += chunk;
        });
        // The whole response has been received. Print out the result.
        resp.on('end', () => {
            //console.log("data = " + data);
            console.log(dateTime.create().format('Y-m-d H:M:S ') + (index+1) + " of " + fileList.length + ", " + fileNameAndPath + ", Thumbnail " + data);
            if (index < fileList.length - 1) {
                //setTimeout(createThumbnail, delayMs, index + 1);
                // Proceed to the next file after a short delay
                setTimeout(transferFile, 10, index + 1);
            } else {
                ftpClient.end();
            }

        });
    }).on("error", (e) => {
        console.log("Error: " + e.message);
        // Wait X seconds and try the same one again
        setTimeout(createThumbnail, 3000, index);
        //Error: connect ETIMEDOUT 173.205.127.190:443
    });

} // function createThumbnail(index) {
