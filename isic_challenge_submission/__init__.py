###############################################################################
#  Copyright Kitware Inc.
#
#  Licensed under the Apache License, Version 2.0 ( the "License" );
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
###############################################################################

import io
import os
import zipfile

from girder import events, logger, plugin
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload
from girder.models.user import User
from girder.utility.model_importer import ModelImporter


READ_SIZE = 4 * 1024 * 1024


def _readFile(file):
    """
    Read file data into an in-memory buffer.

    :param file: File document.
    :type file: dict
    :return: A buffer that contains the file data.
    """
    buffer = io.BytesIO()
    with File().open(file) as fileHandle:
        while True:
            chunk = fileHandle.read(size=READ_SIZE)
            if not chunk:
                break
            buffer.write(chunk)
    return buffer


def _isPDF(zipItem):
    """
    Check whether an item in a ZIP file is a normal PDF file.

    This ignores metadata added to ZIP files on Mac OS X.

    :param zipItem: An item in a ZIP file, such as those returned by zipfile.infolist().
    :type zipItem: zipfile.ZipInfo
    :return: True if the item is a normal PDF file.
    """
    filename = zipItem.filename

    # Ignore Mac OS X metadata
    if filename.startswith('__MACOSX'):
        return False

    return filename.lower().endswith('.pdf')


def _savePDF(event):
    """
    Extract PDF from submission ZIP file and save to a subfolder of the submission folder.

    Event info should contain the following fields:
    - submission: The submission document.
    - folder: The submission folder document.
    - file: The submission ZIP file document.
    """
    submission = event.info['submission']
    folder = event.info['folder']
    file = event.info['file']

    # Read submission ZIP file data into an in-memory buffer.
    # Reading into memory avoids managing temporary files and directories.
    zipData = _readFile(file)

    # Parse ZIP data to get PDF file name and data
    try:
        with zipfile.ZipFile(zipData) as zipFile:
            pdfItems = [
                zipItem
                for zipItem in zipFile.infolist()
                if _isPDF(zipItem)
            ]
            if not pdfItems or len(pdfItems) > 1:
                logger.warning(
                    'Submission ZIP file contains multiple PDF files (FileId=%s)' % file['_id'])
                return
            pdfItem = pdfItems[0]
            pdfFileName = os.path.basename(pdfItem.filename)
            pdfData = zipFile.read(pdfItem)
            if not pdfData:
                logger.warning(
                    'Submission ZIP file contains empty PDF file (FileId=%s)' % file['_id'])
                return
    except zipfile.BadZipfile:
        logger.warning('Failed to process submission ZIP file (FileId=%s)' % file['_id'])
        return

    # Save PDF file to a subfolder of the submission folder
    user = User().load(submission['creatorId'], force=True)
    abstractFolder = Folder().createFolder(parent=folder, name='Abstract', creator=user)
    abstractFile = Upload().uploadFromFile(
        obj=io.BytesIO(pdfData),
        size=len(pdfData),
        name=pdfFileName,
        parentType='folder',
        parent=abstractFolder,
        user=user,
        mimeType='application/pdf'
    )

    # Set submission documentation URL
    submission['documentationUrl'] = \
        'https://challenge.kitware.com/api/v1/file/%s/download?contentDisposition=inline' % \
        abstractFile['_id']
    ModelImporter.model('submission', 'covalic').save(submission)


def afterPostScore(event):
    """
    Post-process submissions that were successfully scored.

    In test phases, users are required to submit an abstract in PDF format that describes
    their approach. This function extracts the PDF file from the submission ZIP file and
    saves it to a subfolder of the submission folder.

    This processing runs asynchronously to avoid delaying the scoring endpoint response.
    """
    submission = ModelImporter.model('submission', 'covalic').load(event.info['id'])
    phase = ModelImporter.model('phase', 'covalic').load(submission['phaseId'], force=True)

    # Handle only submissions to ISIC 2018 Final Test phases
    isicPhase = phase.get('meta', {}).get('isic2018')
    if isicPhase != 'final':
        return

    # Load submission folder
    folder = Folder().load(submission['folderId'], force=True)
    if not folder:
        logger.warning(
            'afterPostScore: Failed to load submission folder; aborting (FolderId=%s)'
            % folder['_id'])
        return

    # Expect only one item in the folder
    items = list(Folder().childItems(folder, limit=2))
    if not items or len(items) > 1:
        logger.warning(
            'afterPostScore: Found more than one item in submission folder; aborting (FolderId=%s)'
            % folder['_id'])
        return

    # Expect only one file in the item
    item = items[0]
    files = list(Item().childFiles(item, limit=2))
    if not files or len(files) > 1:
        logger.warning(
            'afterPostScore: Found more than one file in submission item; aborting (ItemId=%s)'
            % item['_id'])
        return

    # Abort if submission folder already contains an 'Abstract' folder
    abstractFolder = Folder().findOne(
        query={
            'parentId': folder['_id'],
            'parentCollection': 'folder',
            'name': 'Abstract'
        },
        fields=['_id']
    )
    if abstractFolder is not None:
        logger.warning(
            'afterPostScore: Abstract folder already exists in submission folder; aborting '
            '(FolderId=%s)' % folder['_id'])
        return

    # Process asynchronously
    events.daemon.trigger(info={
        'submission': submission,
        'folder': folder,
        'file': files[0]
    }, callback=_savePDF)


class GirderPlugin(plugin.GirderPlugin):
    DISPLAY_NAME = 'ISIC Challenge Submission'
    CLIENT_SOURCE_PATH = 'web_client'

    def load(self, info):
        # Add event listeners
        events.bind('rest.post.covalic_submission/:id/score.after', 'isic_challenge_submission',
                    afterPostScore)
