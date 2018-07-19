import _ from 'underscore';
import { getCurrentUser } from 'girder/auth';
import { SORT_DESC } from 'girder/constants';
import { wrap } from 'girder/utilities/PluginUtils';

import submitViewForm from './templates/submitViewForm.pug';
import './stylesheets/submitViewForm.styl';

const maxTextLength = 80;
const maxUrlLength = 1024;

export default function (SubmitView, SubmissionCollection, router) {
    function getIsicPhase(view) {
        const meta = view.phase.get('meta');
        return meta && meta.isic2018;
    }

    function shouldWrap(view) {
        const isicPhase = getIsicPhase(view);
        return isicPhase === 'validation' || isicPhase === 'final';
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

    function readAndValidateInputs() {
        const val = this.$('.isic-submission-external-datasources-input:checked').val();
        if (val === 'yes') {
            this.usesExternalData = true;
        } else if (val === 'no') {
            this.usesExternalData = false;
        } else {
            this.usesExternalData = null;
        }
        this.allowShare = this.$('.isic-submission-allow-share-input').prop('checked');
        return this.validateInputs();
    }

    // Put this in a new function to avoid returning false to mean "preventDefault".
    function inputChangeHandler() {
        readAndValidateInputs.call(this);
    }

    wrap(SubmitView, 'initialize', function (initialize) {
        initialize.apply(this, _.rest(arguments));
        if (!shouldWrap(this)) {
            return;
        }

        this.usesExternalData = null;
        this.allowShare = false;
        this.createNewApproach = false;

        setDefaultsFromApproach(this);
    });

    wrap(SubmitView, 'render', function (render) {
        render.call(this);
        if (!shouldWrap(this)) {
            return this;
        }

        const approaches = _.filter(this.approaches, (approach) => approach !== 'default');
        const maxApproaches = getIsicPhase(this) === 'final' ? 3 : 0;
        if (!approaches.length) {
            this.createNewApproach = true;
        } else if (maxApproaches && approaches.length >= maxApproaches) {
            this.createNewApproach = false;
        }

        this.$('.c-submission-approach-input').typeahead('destroy');
        this.$('.c-submit-page-description').remove();
        this.$('.c-submit-uploader-container').html(submitViewForm({
            maxTextLength,
            maxUrlLength,
            maxApproaches,
            phase: this.phase,
            approach: this.approach,
            approaches,
            createNewApproach: this.createNewApproach,
            organization: this.organization,
            organizationUrl: this.organizationUrl,
            documentationUrl: this.documentationUrl,
            usesExternalData: this.usesExternalData
        }));

        this.uploadWidget.startUpload = _.wrap(this.uploadWidget.startUpload, (startUpload) => {
            if (readAndValidateInputs.call(this)) {
                return startUpload.call(this.uploadWidget);
            }
        });
        this.uploadWidget.setUploadEnabled(true);
        this.uploadWidget.setElement(this.$('.c-submit-upload-widget')).render();
        this.$('.c-submit-upload-widget .g-start-upload').text('Submit');

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
        } else if (this.phase.enableOrganization() && this.phase.requireOrganization() && _.isEmpty(this.organization)) {
            errorText = 'Please enter an organization or team name.';
            valid = false;
        } else if (this.phase.enableOrganizationUrl() && this.phase.requireOrganizationUrl() && _.isEmpty(this.organizationUrl)) {
            errorText = 'Please enter a URL for the organization or team.';
            valid = false;
        } else if (this.phase.enableDocumentationUrl() && this.phase.requireDocumentationUrl() && _.isEmpty(this.documentationUrl)) {
            errorText = 'Please enter a URL for your arxiv abstract.';
            valid = false;
        } else if (!_.isBoolean(this.usesExternalData)) {
            errorText = 'You must answer whether or not you used any external data sources.';
            valid = false;
        } else if (!this.$('.isic-submission-allow-share-input').prop('checked')) {
            errorText = 'You must agree to the data sharing policy before submitting.';
            valid = false;
        }

        if (!valid && this.hasFiles) {
            this.$('.c-submission-validation-error').text(errorText);
        }

        return valid && this.filesCorrect;
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
        'click .isic-create-new-approach-button': function (event) {
            this.createNewApproach = !this.createNewApproach;
            this.approach = '';
            if (!this.createNewApproach && this.approaches.length) {
                this.approach = this.approaches[0];
            }
            this.render();
        },
        'change .isic-submission-approach-input': function (event) {
            this.approach = $(event.currentTarget).val();
            setDefaultsFromApproach(this);
        },
        'input .isic-submission-create-approach-input': function (event) {
            this.approach = $(event.currentTarget).val().trim();
            this.validateInputs();
        },
        'input .isic-submission-external-datasources-input': inputChangeHandler,
        'change .isic-submission-external-datasources-input': inputChangeHandler,
        'click .isic-submission-external-datasources-input': inputChangeHandler,
        'input .isic-submission-allow-share-input': inputChangeHandler,
        'change .isic-submission-allow-share-input': inputChangeHandler,
        'click .isic-submission-allow-share-input': inputChangeHandler
    });
}
