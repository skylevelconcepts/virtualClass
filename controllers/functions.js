
const fs = require('fs')
const cloudinary = require('cloudinary')
const Model = require('../model/schema')
const bcrypt = require('bcryptjs')
const shortid = require('shortid')
"use strict";
const nodemailer = require("nodemailer");
const handlebars = require("handlebars")
const path = require("path")

const settings = require('./baseData')

const emailTemplateSource = fs.readFileSync(path.join(__dirname, "../template/email_template.hbs"), "utf8")
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_SECRET_KEY
});
// const smtpTransport = nodemailer.createTransport({
//   service: process.env.HOST,
//   port: 465,
//   secure: true, // true for 465, false for other ports
//   logger: false,
//   debug: false,
//   secureConnection: false,
//   auth: {
//     user: process.env.USER_EMAIL,
//     pass: process.env.PASS
//   },
//   tls:{
//     rejectUnAuthorized:true
//   }
// })

const smtpTransport = nodemailer.createTransport({
  host: process.env.HOST,
  port: 465,
  secure: true,
  auth: {
    user: process.env.USER_EMAIL,
    pass: process.env.PASS,
  }
})

const template = handlebars.compile(emailTemplateSource)

module.exports.register_user = async function(req, resp, next) {
  try {
    if (req.files) {
      const user_profile_image = req.files.file
      const names = req.body.names
      const email = req.body.email
      const user_type = req.body.user_type

       //HASH USER PASSWORD
      const salt = await bcrypt.genSalt(10)
      const password = await bcrypt.hash(req.body.password, salt)

      const allowed_files = [".jpeg", ".JPEG", ".jpg", ".JPG", ".PNG", ".png", ".ppm", ".pgm", ".webp", ".pbm", ".tiff"]
      let file_name = user_profile_image.name
      file_path = './upload/' + file_name

      let start = file_name.indexOf(".")
      let file_type = file_name.slice(start, file_name.length)

      if (allowed_files.includes(file_type)) {
        let userExist = await Model.users.findOne({email: email})
        if (userExist) {
          return resp.status(200).json({reply: `User already exist`})
        } else {
          user_profile_image.mv(file_path, async function(err) {
            if (err) throw(err)
            cloudinary.v2.uploader.upload(file_path, async function(error, result) {
              if (error) return console.log(error)
              fs.unlinkSync(file_path)
              let newUser = new Model.users({
                names: names,
                email: email,
                user_type: user_type,
                password: password,
                user_profile_image_path: result.secure_url,
              })
              savedUser = await newUser.save()
              resp.status(200).json({reply:"success"})
            })
          })
        } 
      } else {
        return resp.status(200).json({reply: "image not supported"})
      }
    } else {
      resp.status(200).json({reply: "Please provide a profile picture"})
    }
  } catch (error) {
    console.log(error)
    next(error)
  }
}

module.exports.login = async (req, resp, next) => {
  const email = req.body.email
  const password = req.body.password
  try {
    const user = await Model.users.findOne({email: email})
    if (!user) return resp.status(200).json({reply: "No account found for this email address"})
    // CONFIRM USER PASSWORD
    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) return resp.status(200).json({reply: "Invalid passsword"})
    resp.status(200).json({
      reply: 'success',
      user: user._id
    })
  } catch (error) {
    next(error)
  }
}

// module.exports.logout = async (req, resp, next) => {
//   const email = req.body.email
//   const password = req.body.password
//   try {
//     const user = await Model.users.findOne({email: email})
//     if (!user) return resp.status(200).json({reply: "No account found for this email address"})
//     // CONFIRM USER PASSWORD
//     const validPassword = await bcrypt.compare(password, user.password)
//     if (!validPassword) return resp.status(200).json({reply: "Invalid passsword"})
//     resp.status(200).json({
//       reply: 'success',
//       user: user
//     })
//   } catch (error) {
//     next(error)
//   }
// }

module.exports.host_meeting = async (req, resp, next) => {
  resp.status(200).redirect(`${settings.baseUrl}host_meeting.html`)
}

module.exports.schedule_meeting = async (req, resp, next) => {
  try {
    const title = req.body.title
    const host = req.body.current_user
    const date = req.body.date
    const from = req.body.from
    const to = req.body.to
    const meeting_id = shortid.generate()
  
    let newMeeting = new Model.meetings ({
      meeting_id: meeting_id,
      title: title,
      host: host,
      status: settings.MEETING_STATUS.PENDING,
      date: date,
      from: from,
      to: to
    })
  
    await newMeeting.save( async (err, data) => {
      if(err) return next(err)
      const host_info = await Model.users.findOne({_id: data.host})

      const htmlToSend = template({
        meeting_title: data.title,
        meeting_id: data.meeting_id,
        host: host_info.names,
        meeting_date: data.date,
        start_time: data.from,
        end_time: data.to
      })
      const mailOptions = {
        from: process.env.USER_EMAIL, 
        to: host_info.email,
        subject: "Meeting Details",
        html: htmlToSend
      }
      smtpTransport.sendMail(mailOptions, function(error, response) {
        if (error) {
          console.log(error)
          return next(error)
        } else {
          resp.status(200).json({
            reply: 'success',
            meeting: data,
            hostName: host_info.names
          })
        }
      })                                      
    })
  } catch (error) {
    console.log(error)
    const err = new Error(error)
    err.status = 500
    return next(err)
  }
}

module.exports.join_meeting = async (req, resp, next) => {
  resp.status(200).redirect(`${settings.baseUrl}join_meeting.html`)
}

module.exports.join_meeting_by_id = async (req, resp, next) => {
  try {
    const id = req.params.id
    const user = req.params.user
    const meeting = await Model.meetings.findOne({meeting_id: id})
    if (meeting) {
      if (meeting.participants.indexOf(user) >= 0) {
        resp.status(200).json({
          reply: "Hey!!! Someone is representing you in the meeting already"
        })
      } else {
        meeting.participants.push(user)
        if (meeting.host == user) {
          await Model.meetings
          .findOneAndUpdate(
            {meeting_id: meeting.meeting_id},
            {
              status: settings.MEETING_STATUS.IN_PROGRESS,
              participants: meeting.participants
            },
            {new: true}, async (err, data) => {
              if (err) next(err)
              const recipient = await Model.users.findOne({_id: user}, {password: false})
              resp.status(200).json({
                reply: 'success',
                meeting: data,
                recipient: recipient
              })
          }).catch((error) => {
            next(err)
          })
        } else if (meeting.status === 'PENDING') {
          resp.status(200).json({
            reply: "The meeting host is yet to start the meeting, Please check back"
          })
        } else if (meeting.status === 'CLOSED') {
          resp.status(200).json({
            reply: "The meeting is over, contact the host for a reschedule"
          })
        } else {
          await Model.meetings
          .findOneAndUpdate(
            {meeting_id: meeting.meeting_id},
            { participants: meeting.participants },
            {new: true}, async (err, data) => {
              if (err) return next(err)
              const recipient = await Model.users.findOne({_id: user}, {password: false})
              resp.status(200).json({
                reply: 'success',
                meeting: data,
                recipient: recipient
              })
          }).catch((error) => {
            next(err)
          })
        }
      }
    } else {
      resp.status(200).json({
        reply: "Oops, Invalid meeting ID"
      })
    }
  } catch (error) {
    console.log(error)
    next(error)
  }
}

module.exports.feedback = async (req, resp, next) => {
  const respondent = req.body.respondent
  const message = req.body.message

  let newFeedback = new Model.feedbacks({
    respondent: respondent,
    message: message
  })
  await newFeedback.save()
  resp.status(200).json({
    reply: 'success',
    message: 'Feedback recieved, Thank you for sharing your thought.',
  })
}
