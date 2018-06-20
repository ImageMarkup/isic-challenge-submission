import _ from 'underscore';
import { getCurrentUser } from 'girder/auth';
import { SORT_DESC } from 'girder/constants';
import { wrap } from 'girder/utilities/PluginUtils';

import submitViewForm from './templates/submitViewForm.pug';
import './stylesheets/submitViewForm.styl';

const maxTextLength = 80;
const maxUrlLength = 1024;

export default function (SubmitView, SubmissionCollection, router, challengeId) {
    function shouldWrap(view) {
        return view.phase.get('challengeId') === challengeId;
    }

    function setDefaultsFromApproach(view) {
        const user = getCurrentUser();
        if (!user) {
            return;
        }

        const params = {
            userId: user.id,
            phaseId: view.phase.id,
            latest: false
        };
        if (view.approach) {
            params.approach = view.approach;
        }

        const submissions = new SubmissionCollection();
        submissions.pageLimit = 1;
        submissions.sortField = 'created';
        submissions.sortDir = SORT_DESC;
        submissions.fetch(params).done(() => {
            if (!submissions.length) {
                return;
            }
            const submission = submissions.at(0);
            const meta = submission.get('meta') || {};
            view.approach = submission.get('approach');
            view.organization = submission.get('organization');
            view.organizationUrl = submission.get('organizationUrl');
            view.documentationUrl = submission.get('documentationUrl');
            view.usesExternalData = meta.usesExternalData;

            view.render();
        });
    }

    wrap(SubmitView, 'initialize', function (initialize) {
        initialize.apply(this, _.rest(arguments));
        if (!shouldWrap(this)) {
            return;
        }

        this.usesExternalData = false;
        this.allowShare = false;

        setDefaultsFromApproach(this);
    });

    wrap(SubmitView, 'render', function (render) {
        render.call(this);
        if (!shouldWrap(this)) {
            return this;
        }

        this.$('.c-submission-approach-input').typeahead('destroy');
        this.$('.c-submit-page-description').remove();
        this.$('.c-submit-uploader-container').html(submitViewForm({
            maxTextLength,
            maxUrlLength,
            approach: this.approach,
            organization: this.organization,
            organizationUrl: this.organizationUrl,
            documentationUrl: this.documentationUrl,
            usesExternalData: this.usesExternalData
        }));

        this.uploadWidget.setElement(this.$('.c-submit-upload-widget')).render();
        this.$('.c-submission-approach-input').typeahead({
            source: this.approaches,
            afterSelect: () => {
                this._updateApproach();
                setDefaultsFromApproach(this);
            }
        });

        return this;
    });

    wrap(SubmitView, 'validateInputs', function (validateInputs) {
        if (!shouldWrap(this)) {
            return validateInputs.call(this);
        }

        this.$('.c-submission-validation-error').empty();

        var valid = true;
        var errorText = null;

        if (_.isEmpty(this.approach)) {
            errorText = 'Please describe your algorithm\'s approach';
            valid = false;
        } else if (_.isEmpty(this.organization)) {
            errorText = 'Please enter an organization or team name.';
            valid = false;
        } else if (_.isEmpty(this.organizationUrl)) {
            errorText = 'Please enter a URL for the organization or team.';
            valid = false;
        } else if (_.isEmpty(this.documentationUrl)) {
            errorText = 'Please enter a URL for your arxiv abstract.';
            valid = false;
        } else if (!this.$('.isic-submission-allow-share-input').prop('checked')) {
            errorText = 'You must agree to the data sharing policy before submitting.';
            valid = false;
        }

        if (!valid && this.hasFiles) {
            this.$('.c-submission-validation-error').text(errorText);
        }

        var enabled = valid && this.filesCorrect;
        this.uploadWidget.setUploadEnabled(enabled);
    });

    wrap(SubmitView, 'uploadFinished', function (uploadFinished) {
        if (!shouldWrap(this)) {
            return uploadFinished.call(this);
        }
        this.submission.on('c:submissionPosted', function () {
            router.navigate(`submission/${this.submission.id}`, {trigger: true});
        }, this).postSubmission({
            phaseId: this.phase.id,
            folderId: this.folder.id,
            title: this.approach,
            organization: this.organization,
            organizationUrl: this.organizationUrl,
            documentationUrl: this.documentationUrl,
            meta: {
                usesExternalData: this.usesExternalData,
                agreeToSharingPolicy: this.allowShare
            },
            approach: this.approach
        });
    });

    Object.assign(SubmitView.prototype.events, {
        'input .isic-submission-external-datasources-input': function (event) {
            const val = $(event.currentTarget).val().trim();
            if (val === 'yes') {
                this.usesExternalData = true;
            } else {
                this.usesExternalData = false;
            }
            this.validateInputs();
        },
        'input .isic-submission-allow-share-input': function (event) {
            this.allowShare = $(event.currentTarget).prop('checked');
            this.validateInputs();
        }
    });
}
