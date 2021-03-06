const SCOPES = 'https://www.googleapis.com/auth/drive.appdata'
const CLIENT_ID = '233361855229-omsegl02h7ggvurbqk4pj0g6drs496js.apps.googleusercontent.com'
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']

const ENTRY_FOLDER = 'entries'

let entryFolderId
let drive

export function authPlatformLoaded () {
  gapi.signin2.render('sign-in-button', {
    'scope': SCOPES,
    'onsuccess': onSignIn,
    'onfailure': onFailedSignIn
  })

  var auth2
  gapi.load('auth2', () => {
    auth2 = gapi.auth2.getAuthInstance()
    if (!auth2.isSignedIn.get()) {
      $('#sign-in-button').css('display', 'block')
    }
  })
}

export function drivePlatformLoaded () {
  var auth2
  return new Promise((resolve, reject) => {
    gapi.load('auth2:client', () => {
      return gapi.client.init({
        apiKey: 'AIzaSyCTeQrI1BY-9gwhf8Iyw1xRasmMH82oM2Q',
        clientId: CLIENT_ID,
        discoveryDocs: DISCOVERY_DOCS,
        scope: SCOPES
      })
      .then(() => {
        // TODO handle changes to user sign-in state
        drive = gapi.client.drive
        if (drive === undefined) {
          throw new Error('Drive API did not load correctly')
        }

        return drive.files.list({
          // find the entries/ folder in the appDataFolder, or create it
          'q': `mimeType='application/vnd.google-apps.folder' and \
                name='${ENTRY_FOLDER}' and \
                'appDataFolder' in parents`,
          'spaces': 'appDataFolder',
          'fields': 'files(id, name)'
        })
      })
      .then((response) => {
        if (response.result.files.length !== 0) {
          return response
        } else {
          return Promise.reject(
            // create entries folder
            drive.files.create({
              'name': ENTRY_FOLDER,
              'mimeType': 'application/vnd.google-apps.folder',
              'parents': ['appDataFolder'],
              'fields': 'id'
            })
          )
        }
      })
      .then((response) => {
        entryFolderId = response.result.files[0].id
        resolve()
      }, (response) => {
        entryFolderId = response.result.id
        resolve()
      })
    })
  })
}

function setProfilePicture () {
  // TODO find better place for this
  let profile = gapi.auth2.getAuthInstance()
    .currentUser.get().getBasicProfile()
  $('.profile-image').attr('src', profile.getImageUrl())
}

function onSignIn (googleUser) {
  // refreshes token on sign in, extending token expiration
  /**
   * TODO this will send a POST request to /login on every page, which causes
   * several problems, currently:
   * 1) If a user is already logged in on the server, this is redundant, and will
   *    log the user in a second time
   * 2) You need some verification method to make sure the Google user and the
   *    logged in user are the same; otherwise, you must do something. The default
   *    behavior would be to just log the other user in, which probably isn't wise
   */
  googleUser.reloadAuthResponse()
    .then(() => {
      // submit AJAX POST request to login api
      $.post({
        url: '/login/',
        data: { 'id_token': googleUser.getAuthResponse().id_token },
        dataType: 'json',
        success: (res) => {
          location.reload()
        },
        error: (err) => {
          console.log(err)
        }
      })
    })
}

function onFailedSignIn (error) {
  console.log(error)
}

export function uploadFile (name, content, mimeType, folderId) {
  var boundary = Math.random().toString(36).slice(2)
  var requestType = `multipart/related; boundary='${boundary}'`
  var metadata = {
    'name': name,
    'mimeType': mimeType,
    'parents': [folderId]
  }

  var body =
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF=8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `\r\n--${boundary}\r\n` +
    `Content-Type: text/plain\r\n\r\n${content}` +
    `\r\n--${boundary}--`

  return gapi.client.request({
    'path': '/upload/drive/v3/files',
    'method': 'POST',
    'params': { 'uploadType': 'multipart' },
    'headers': { 'Content-Type': requestType },
    'body': body
  })
}

function extractTitle (text) {
  var i = text.indexOf('\n')
  return text.slice(0, i).trim()
}

export function createEntry (text) {
  if (drive === undefined) {
    // TODO an error has occurred, drive is not loaded
    return false
  }

  var title = extractTitle(text)

  uploadFile(generateTitle(title), text, 'text/plain', entryFolderId).then(
    (response) => {
      console.log(response)
      $.post({
        url: '/entries',
        data: { 'file_id': response.result.id },
        dataType: 'json',
        success: (entry) => {
          location.reload()
        },
        error: (err) => {
          console.log(err)
        }
      })
    }
  )
}

function getDbEntries () {
  return $.get({
    url: '/entries',
    dataType: 'json'
  })
}

function getDriveEntries () {
  return drive.files.list({
    'q': `mimeType='text/plain' and \
          '${entryFolderId}' in parents`,
    'spaces': 'appDataFolder',
    'fields': 'files(id, name)',
    'orderBy': 'createdTime desc'
  }).then((response) => response.result.files)
}

export function getEntries () {
  // use ajax to get entry objects from backend
  // use drive API to fill file names
  // return objects in a promise

  // TODO, when you create the entry in Drive, get the created time from the result and send it to rails to set in the DB so they are the same
  return getDbEntries().then((entryArray) => {
    // match drive entries to rails results
    if (entryArray) {
      const entryMap = {}
      entryArray.forEach((entry) => {
        entryMap[entry.file_id] = entry
      })
      return entryMap
    } else {
      return Promise.reject(new Error('GET /entries returned undefined'))
    }
  }).then((entryMap) => {
    return getDriveEntries().then((files) => {
      files.forEach((file) => {
        if (file.id in entryMap) {
          entryMap[file.id].title = file.name
        }
      })
      return entryMap
    })
  })
}

export function displayEntries () {
  if (drive === undefined) {
    return false
  }

  drive.files.list({
    'q': `mimeType='text/plain' and \
          '${entryFolderId}' in parents`,
    'spaces': 'appDataFolder',
    'fields': 'files(id, name)',
    'orderBy': 'createdTime desc'
  }).then((response) => {
    response.result.files.forEach((file, index) => {
      var entry = $(`.entry#${file.id}`)
      if (entry.length === 0) {
        return
      }

      entry.find('.entry_title').text(file.name)
      if (entry[0] === $('.entries_list .entry:first-of-type')[0]) {
        // Download text of first entry and set the entry display section
        displayEntry(file.id)
      }
    })
  })
}

function generateTitle (title) {
  var result = title.trim()
  if (result.length !== 0) {
    return result
  } else {
    return 'Untitled Entry'
  }
}

/**
 * Download a file from Drive and return the response as a Promise.
 * @param {string} fileId The Drive id of the desired file.
 * @return {string} The contents of the desired file.
 */
export function downloadEntry (fileId) {
  if (drive === undefined) {
    return null
  }

  return drive.files.get({
    'fileId': fileId,
    'alt': 'media'
  })
}

export function signOut () {
  var auth2 = gapi.auth2.getAuthInstance()
  auth2.signOut().then(() => {
    console.log('User signed out.')
    $('.logout_user').submit()
  })
}
