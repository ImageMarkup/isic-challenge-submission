import pytest

from girder.plugin import loadedPlugins


@pytest.mark.plugin('isic_challenge_submission')
def test_import(server):
    assert 'isic_challenge_submission' in loadedPlugins()
