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
2021-10-30 JJK  Modified to save a last completed timestamp and look for
                files with a timestamp greater than last run
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
var fileInfo = null;
const lastRunFilename = 'lastRunTimestamp.log';
var lastRunTimestamp = new Date('May 27, 95 00:00:00 GMT-0400');


var walkSync = function (dir, filelist) {
    //files = fs.readdirSync(dir);
    files = fs.readdirSync(dir,['utf8','true']);
    filelist = filelist || [];
    files.forEach(function (file) {
        filepath = dir+'/'+file;
        fileInfo = fs.statSync(filepath);

        if (fileInfo.isDirectory()) {
            filelist = walkSync(filepath, filelist);
        }
        else {
            // Only add support file types to the list
            extension = file.substring(file.lastIndexOf(".")+1).toUpperCase();
            if (extension == "JPEG" || extension == "JPG" || extension == "PNG" || extension == "GIF") {

                // File Last Modified
                // fileInfo.mtime = Sat Oct 30 2021 09:50:11 GMT-0400 (Eastern Daylight Time)
                //console.log(filepath);
                //console.log("fileInfo.mtime = "+fileInfo.mtime+", "+lastRunTimestamp);
                //console.log("fileInfo.ctime = "+fileInfo.ctime);
                //console.log("fileInfo.atime = "+fileInfo.atime);

                // Add to the list if the Created or Modified time is greater than the last run time
                if (fileInfo.ctime.getTime() > lastRunTimestamp.getTime() ||
                    fileInfo.mtime.getTime() > lastRunTimestamp.getTime()) {
                    // Add the path minus the LOCAL ROOT
                    //console.log("Adding file = "+file);
                    filelist.push(dir.replace(process.env.LOCAL_PHOTOS_ROOT,'')+'/'+file);
                }
            }
        }
    });
    return filelist;
};

var fileList = null;
fs.readFile(lastRunFilename, function(err, buf) {
    if (!err) {
        lastRunTimestamp = new Date (buf.toString());
    }
    console.log("Last Run Timestamp = "+lastRunTimestamp);

    if (process.env.LAST_RUN_TIMESTAMP_OVERRIDE != undefined) {
        console.log("LAST_RUN_TIMESTAMP_OVERRIDE = "+process.env.LAST_RUN_TIMESTAMP_OVERRIDE);
        lastRunTimestamp = new Date(process.env.LAST_RUN_TIMESTAMP_OVERRIDE);
        console.log("Last Run Timestamp = "+lastRunTimestamp);
    }
    // Start the walkSync to load all the files into the filelist array

    fileList = walkSync(process.env.LOCAL_PHOTOS_ROOT+process.env.PHOTOS_START_DIR);
    //for (var i = 0, len = fileList.length; i < len; i++) {
    //    console.log("fileList[" + i + "] = " + fileList[i]);
    //}
    if (fileList.length > 0) {
        // start transfer
        startTransfer();
    } else {
        console.log("No new pictures found");
        console.log("");
    }
});

var reconnect = false;
var startTime = '';
var ftpClient = new ftp();
var startTransfer = function () {
    console.log(">>> in the startTransfer function");
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
        if (!reconnect) {
            transferFile(0);
        }
    });
    ftpClient.on('end', function () {
        console.log(dateTime.create().format('Y-m-d H:M:S ') + "FTP ended, start time = "+startTime);
        var outTimestamp = new Date();
        //fs.writeFile(lastRunFilename, outTimestamp.getTime(), (err) => {
        fs.writeFile(lastRunFilename, outTimestamp, (err) => {
        if (err) console.log(err);
            //console.log("Successfully Written to File.");
        });
    });
};


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

                            /*
                            reconnect = true;
                            console.log(">>>>> Re-connecting2... ");

                            ftpClient.connect({
                                host: process.env.FTP_HOST,
                                port: process.env.FTP_PORT,
                                user: process.env.FTP_USER,
                                password: process.env.FTP_PASS
                            });

                            // If reconnect was successful (check in future), re-start the transfer
                            //console.log(">>> calling the transferFile, index = "+index);
                            setTimeout(transferFile, 3000, index);
                            */

/*&
                            Some other error in PUT besides No file or directory, err2 = Error: write ECONNRESET
>>>>> Re-connecting2... 
2021-12-28 19:10:02 FTP ended, start time = 2021-12-28 19:02:57 
2021-12-28 19:10:02 FTP ended, start time = 2021-12-28 19:02:57 
*/
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
                /*
2021-12-28 16:50:05 FTP connected, start dir = Photos/1 John J Kauflin/2016-to-2022/2021
2021-12-28 16:50:34 320 of 1210, Photos/1 John J Kauflin/2016-to-2022/2021/03 Summer/20210613_001246240_iOS.jpg, Transferred
2021-12-28 16:50:35 320 of 1210, Photos/1 John J Kauflin/2016-to-2022/2021/03 Summer/20210613_001246240_iOS.jpg, Thumbnail Created
...
2021-12-28 17:00:03 427 of 1210, Photos/1 John J Kauflin/2016-to-2022/2021/03 Summer/20210703_182345012_iOS.jpg, Transferred
2021-12-28 17:00:05 427 of 1210, Photos/1 John J Kauflin/2016-to-2022/2021/03 Summer/20210703_182345012_iOS.jpg, Thumbnail Created

Some other error in PUT besides No file or directory, err2 = Error: read ECONNRESET
UncaughtException, error = Error: read ECONNRESET
Error: read ECONNRESET
    at TCP.onStreamRead (internal/stream_base_commons.js:111:27)

>>> probably lost connection after 10 minutes
>>> re-connect and try again
                */

/*
                reconnect = true;
                console.log(">>>>> Re-connecting... ");

                ftpClient.connect({
                    host: process.env.FTP_HOST,
                    port: process.env.FTP_PORT,
                    user: process.env.FTP_USER,
                    password: process.env.FTP_PASS
                });

                // If reconnect was successful (check in future), re-start the transfer
                //console.log(">>> calling the transferFile, index = "+index);
                setTimeout(transferFile, 3000, index);
*/

                // else throw error
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
