/** @format */

/**
 * External dependencies
 */

import React, { Component } from 'react';
import { connect } from 'react-redux';
import {
	camelCase,
	find,
	filter,
	forEach,
	get,
	head,
	includes,
	keys,
	map,
	mapKeys,
	merge,
	pick,
	snakeCase,
} from 'lodash';
import debugModule from 'debug';
import classNames from 'classnames';
import { localize } from 'i18n-calypso';
import page from 'page';
import PropTypes from 'prop-types';
import { abtest } from 'lib/abtest';

/**
 * Internal dependencies
 */
import { localizeUrl } from 'lib/i18n-utils';
import { isCrowdsignalOAuth2Client, isWooOAuth2Client } from 'lib/oauth2-clients';
import wpcom from 'lib/wp';
import config from 'config';
import analytics from 'lib/analytics';
import Button from 'components/button';
import FormInputValidation from 'components/forms/form-input-validation';
import FormLabel from 'components/forms/form-label';
import FormPasswordInput from 'components/forms/form-password-input';
import FormSettingExplanation from 'components/forms/form-setting-explanation';
import FormTextInput from 'components/forms/form-text-input';
import FormButton from 'components/forms/form-button';
import getCurrentQueryArguments from 'state/selectors/get-current-query-arguments';
import notices from 'notices';
import Notice from 'components/notice';
import LoggedOutForm from 'components/logged-out-form';
import { login } from 'lib/paths';
import formState from 'lib/form-state';
import LoggedOutFormLinks from 'components/logged-out-form/links';
import LoggedOutFormLinkItem from 'components/logged-out-form/link-item';
import LoggedOutFormBackLink from 'components/logged-out-form/back-link';
import LoggedOutFormFooter from 'components/logged-out-form/footer';
import PasswordlessSignupForm from 'blocks/signup-form/passwordless';
import CrowdsignalSignupForm from './crowdsignal';
import SocialSignupForm from './social';
import { recordTracksEventWithClientId as recordTracksEvent } from 'state/analytics/actions';
import { createSocialUserFailed } from 'state/login/actions';
import { getCurrentOAuth2Client } from 'state/ui/oauth2-clients/selectors';
import { getSectionName } from 'state/ui/selectors';
import TextControl from 'extensions/woocommerce/components/text-control';

/**
 * Style dependencies
 */
import './style.scss';

const VALIDATION_DELAY_AFTER_FIELD_CHANGES = 2000,
	debug = debugModule( 'calypso:signup-form:form' );

let usernamesSearched = [],
	timesUsernameValidationFailed = 0,
	timesPasswordValidationFailed = 0;

const resetAnalyticsData = () => {
	usernamesSearched = [];
	timesUsernameValidationFailed = 0;
	timesPasswordValidationFailed = 0;
};

class SignupForm extends Component {
	static propTypes = {
		className: PropTypes.string,
		disableEmailExplanation: PropTypes.string,
		disableEmailInput: PropTypes.bool,
		disabled: PropTypes.bool,
		displayNameInput: PropTypes.bool,
		displayUsernameInput: PropTypes.bool,
		email: PropTypes.string,
		flowName: PropTypes.string,
		footerLink: PropTypes.node,
		formHeader: PropTypes.node,
		redirectToAfterLoginUrl: PropTypes.string.isRequired,
		goToNextStep: PropTypes.func,
		handleSocialResponse: PropTypes.func,
		isSocialSignupEnabled: PropTypes.bool,
		locale: PropTypes.string,
		positionInFlow: PropTypes.number,
		save: PropTypes.func,
		signupDependencies: PropTypes.object,
		step: PropTypes.object,
		submitButtonText: PropTypes.string.isRequired,
		submitting: PropTypes.bool,
		suggestedUsername: PropTypes.string.isRequired,
		translate: PropTypes.func.isRequired,

		// Connected props
		oauth2Client: PropTypes.object,
		sectionName: PropTypes.string,
	};

	static defaultProps = {
		displayNameInput: false,
		displayUsernameInput: true,
		flowName: '',
		isSocialSignupEnabled: false,
	};

	state = {
		notice: null,
		submitting: false,
		focusPassword: false,
		focusUsername: false,
		form: null,
		signedUp: false,
		validationInitialized: false,
	};

	getInitialFields() {
		return {
			firstName: '',
			lastName: '',
			email: this.props.email || '',
			username: '',
			password: '',
		};
	}

	autoFillUsername( form ) {
		if ( formState.getFieldValue( form, 'username' ) ) {
			return form;
		}

		const value = this.props.suggestedUsername || '';
		return merge( form, { username: { value } } );
	}

	recordBackLinkClick = () => {
		analytics.tracks.recordEvent( 'calypso_signup_back_link_click' );
	};

	UNSAFE_componentWillMount() {
		debug( 'Mounting the SignupForm React component.' );
		this.formStateController = new formState.Controller( {
			initialFields: this.getInitialFields(),
			sanitizerFunction: this.sanitize,
			validatorFunction: this.validate,
			onNewState: this.setFormState,
			onError: this.handleFormControllerError,
			debounceWait: VALIDATION_DELAY_AFTER_FIELD_CHANGES,
			hideFieldErrorsOnChange: true,
			initialState: this.props.step ? this.props.step.form : undefined,
			skipSanitizeAndValidateOnFieldChange: true,
		} );

		const initialState = this.formStateController.getInitialState();
		const stateWithFilledUsername = this.autoFillUsername( initialState );

		this.maybeRedirectToSocialConnect( this.props );

		this.setState( { form: stateWithFilledUsername } );
	}

	getUserExistsError( props ) {
		const { step } = props;

		if ( ! step || step.status !== 'invalid' ) {
			return null;
		}

		const userExistsError = find( step.errors, error => error.error === 'user_exists' );

		return userExistsError;
	}

	/***
	 * If the step is invalid because we had an error that the user exists,
	 * we should prompt user with a request to connect his social account
	 * to his existing WPCOM account
	 *
	 * @param {Object} props react component props that has step info
	 */
	maybeRedirectToSocialConnect( props ) {
		const userExistsError = this.getUserExistsError( props );

		if ( userExistsError ) {
			const { service, id_token, access_token } = props.step;
			const socialInfo = { service, id_token, access_token };

			this.props.createSocialUserFailed( socialInfo, userExistsError );
			page(
				login( {
					isNative: config.isEnabled( 'login/native-login-links' ),
					redirectTo: this.props.redirectToAfterLoginUrl,
				} )
			);
		}
	}

	UNSAFE_componentWillReceiveProps( nextProps ) {
		if ( this.props.step && nextProps.step && this.props.step.status !== nextProps.step.status ) {
			this.maybeRedirectToSocialConnect( nextProps );
		}
	}

	sanitizeEmail( email ) {
		return email && email.replace( /\s+/g, '' ).toLowerCase();
	}

	sanitizeUsername( username ) {
		return username && username.replace( /[^a-zA-Z0-9]/g, '' ).toLowerCase();
	}

	sanitize = ( fields, onComplete ) => {
		const sanitizedEmail = this.sanitizeEmail( fields.email );
		const sanitizedUsername = this.sanitizeUsername( fields.username );

		if ( fields.email !== sanitizedEmail || fields.username !== sanitizedUsername ) {
			onComplete( {
				email: sanitizedEmail,
				username: sanitizedUsername,
			} );
		}
	};

	validate = ( fields, onComplete ) => {
		const fieldsForValidation = filter( [
			'email',
			this.state.focusPassword && 'password',
			this.props.displayUsernameInput && 'username',
			this.props.displayNameInput && 'firstName',
			this.props.displayNameInput && 'lastName',
		] );

		const data = mapKeys( pick( fields, fieldsForValidation ), ( value, key ) => snakeCase( key ) );
		wpcom.undocumented().validateNewUser( data, ( error, response ) => {
			if ( this.props.submitting ) {
				// this is a stale callback, we have already signed up or are logging in
				return;
			}

			if ( error || ! response ) {
				return debug( error || 'User validation failed.' );
			}

			let messages = response.success
				? {}
				: mapKeys( response.messages, ( value, key ) => camelCase( key ) );

			forEach( messages, ( fieldError, field ) => {
				if ( ! formState.isFieldInvalid( this.state.form, field ) ) {
					return;
				}

				if ( field === 'username' && ! includes( usernamesSearched, fields.username ) ) {
					analytics.tracks.recordEvent( 'calypso_signup_username_validation_failed', {
						error: head( keys( fieldError ) ),
						username: fields.username,
					} );

					timesUsernameValidationFailed++;
				}

				if ( field === 'password' ) {
					analytics.tracks.recordEvent( 'calypso_signup_password_validation_failed', {
						error: head( keys( fieldError ) ),
					} );

					timesPasswordValidationFailed++;
				}
			} );

			if ( fields.email ) {
				if ( this.props.signupDependencies && this.props.signupDependencies.domainItem ) {
					const domainInEmail = fields.email.split( '@' )[ 1 ];
					if ( this.props.signupDependencies.domainItem.meta === domainInEmail ) {
						// if the user tries to use an email address from the domain they're trying to register,
						// show an error message.
						messages = Object.assign( {}, messages, {
							email: {
								invalid: this.props.translate(
									'Use a working email address, so you can receive our messages.'
								),
							},
						} );
					}
				}
			}

			onComplete( error, messages );
			if ( ! this.state.validationInitialized ) {
				this.setState( { validationInitialized: true } );
			}
		} );
	};

	setFormState = state => {
		this.setState( { form: state } );
	};

	handleFormControllerError( error ) {
		if ( error ) {
			throw error;
		}
	}

	handleChangeEvent = event => {
		const name = event.target.name,
			value = event.target.value;

		this.setState( { notice: null } );

		this.formStateController.handleFieldChange( {
			name: name,
			value: value,
		} );
	};

	handleBlur = event => {
		const fieldId = event.target.id;
		// Ensure that username and password field validation does not trigger prematurely
		if ( fieldId === 'password' ) {
			this.setState( { focusPassword: true }, () => {
				this.validateAndSaveForm();
			} );
			return;
		}
		if ( fieldId === 'username' ) {
			this.setState( { focusUsername: true }, () => {
				this.validateAndSaveForm();
			} );
			return;
		}

		this.validateAndSaveForm();
	};

	validateAndSaveForm = () => {
		const data = this.getUserData();
		// When a user moves away from the signup form without having entered
		// anything do not show error messages, think going to click log in.
		if ( data.username.length === 0 && data.password.length === 0 && data.email.length === 0 ) {
			return;
		}

		this.formStateController.sanitize();
		this.formStateController.validate();
		this.props.save && this.props.save( this.state.form );
	};

	handleSubmit = event => {
		event.preventDefault();

		if ( this.state.submitting ) {
			return;
		}

		this.setState( { submitting: true } );

		if ( this.props.submitting ) {
			resetAnalyticsData();

			// the user was already created, so skip validation continue
			this.props.goToNextStep();
			return;
		}

		this.formStateController.handleSubmit( hasErrors => {
			if ( hasErrors ) {
				this.setState( { submitting: false } );
				return;
			}

			const analyticsData = {
				unique_usernames_searched: usernamesSearched.length,
				times_username_validation_failed: timesUsernameValidationFailed,
				times_password_validation_failed: timesPasswordValidationFailed,
			};

			this.props.submitForm( this.state.form, this.getUserData(), analyticsData, () => {
				this.setState( { submitting: false } );
			} );

			resetAnalyticsData();
		} );
	};

	isJetpack() {
		return 'jetpack-connect' === this.props.sectionName;
	}

	getLoginLink() {
		return login( {
			isJetpack: this.isJetpack(),
			isWoo:
				config.isEnabled( 'jetpack/connect/woocommerce' ) && this.props.isJetpackWooCommerceFlow,
			isNative: config.isEnabled( 'login/native-login-links' ),
			redirectTo: this.props.redirectToAfterLoginUrl,
			locale: this.props.locale,
			oauth2ClientId: this.props.oauth2Client && this.props.oauth2Client.id,
			wccomFrom: this.props.wccomFrom,
		} );
	}

	getNoticeMessageWithLogin( notice ) {
		const link = this.getLoginLink();

		if ( notice.error === '2FA_enabled' ) {
			return (
				<span>
					<p>
						{ notice.message }
						&nbsp;
						{ this.props.translate( '{{a}}Log in now{{/a}} to finish signing up.', {
							components: {
								a: <a href={ link } onClick={ this.props.trackLoginMidFlow } />,
							},
						} ) }
					</p>
				</span>
			);
		}
		return notice.message;
	}

	globalNotice( notice ) {
		return (
			<Notice
				className="signup-form__notice"
				showDismiss={ false }
				status={ notices.getStatusHelper( notice ) }
				text={ this.getNoticeMessageWithLogin( notice ) }
			/>
		);
	}

	getUserData() {
		return {
			username: formState.getFieldValue( this.state.form, 'username' ),
			password: formState.getFieldValue( this.state.form, 'password' ),
			email: formState.getFieldValue( this.state.form, 'email' ),
			extra: {
				first_name: formState.getFieldValue( this.state.form, 'firstName' ),
				last_name: formState.getFieldValue( this.state.form, 'lastName' ),
			},
		};
	}

	getErrorMessagesWithLogin( fieldName ) {
		const messages = formState.getFieldErrorMessages( this.state.form, fieldName );
		if ( ! messages ) {
			return;
		}

		let link = this.getLoginLink();

		return map( messages, ( message, error_code ) => {
			if ( error_code === 'taken' ) {
				link +=
					'&email_address=' +
					encodeURIComponent( formState.getFieldValue( this.state.form, fieldName ) );
				return (
					<span key={ error_code }>
						<p>
							{ message }
							&nbsp;
							{ this.props.translate( 'If this is you {{a}}log in now{{/a}}.', {
								components: {
									a: <a href={ link } onClick={ this.props.trackLoginMidFlow } />,
								},
							} ) }
						</p>
					</span>
				);
			}
			return message;
		} );
	}

	formFields() {
		const isEmailValid =
			! this.props.disableEmailInput && formState.isFieldValid( this.state.form, 'email' );

		return (
			<div>
				{ this.props.displayNameInput && (
					<>
						<FormLabel htmlFor="firstName">{ this.props.translate( 'Your first name' ) }</FormLabel>
						<FormTextInput
							autoCorrect="off"
							className="signup-form__input"
							disabled={ this.state.submitting || !! this.props.disabled }
							id="firstName"
							name="firstName"
							value={ formState.getFieldValue( this.state.form, 'firstName' ) }
							isError={ formState.isFieldInvalid( this.state.form, 'firstName' ) }
							isValid={ formState.isFieldValid( this.state.form, 'firstName' ) }
							onBlur={ this.handleBlur }
							onChange={ this.handleChangeEvent }
						/>

						{ formState.isFieldInvalid( this.state.form, 'firstName' ) && (
							<FormInputValidation isError text={ this.getErrorMessagesWithLogin( 'firstName' ) } />
						) }

						<FormLabel htmlFor="lastName">{ this.props.translate( 'Your last name' ) }</FormLabel>
						<FormTextInput
							autoCorrect="off"
							className="signup-form__input"
							disabled={ this.state.submitting || !! this.props.disabled }
							id="lastName"
							name="lastName"
							value={ formState.getFieldValue( this.state.form, 'lastName' ) }
							isError={ formState.isFieldInvalid( this.state.form, 'lastName' ) }
							isValid={ formState.isFieldValid( this.state.form, 'lastName' ) }
							onBlur={ this.handleBlur }
							onChange={ this.handleChangeEvent }
						/>

						{ formState.isFieldInvalid( this.state.form, 'lastName' ) && (
							<FormInputValidation isError text={ this.getErrorMessagesWithLogin( 'lastName' ) } />
						) }
					</>
				) }

				<FormLabel htmlFor="email">{ this.props.translate( 'Your email address' ) }</FormLabel>
				<FormTextInput
					autoCapitalize="off"
					autoCorrect="off"
					className="signup-form__input"
					disabled={
						this.state.submitting || !! this.props.disabled || !! this.props.disableEmailInput
					}
					id="email"
					name="email"
					type="email"
					value={ formState.getFieldValue( this.state.form, 'email' ) }
					isError={ formState.isFieldInvalid( this.state.form, 'email' ) }
					isValid={ this.state.validationInitialized && isEmailValid }
					onBlur={ this.handleBlur }
					onChange={ this.handleChangeEvent }
				/>
				{ this.emailDisableExplanation() }

				{ formState.isFieldInvalid( this.state.form, 'email' ) && (
					<FormInputValidation isError text={ this.getErrorMessagesWithLogin( 'email' ) } />
				) }

				{ this.props.displayUsernameInput && (
					<>
						<FormLabel htmlFor="username">
							{ this.props.translate( 'Choose a username' ) }
						</FormLabel>
						<FormTextInput
							autoCapitalize="off"
							autoCorrect="off"
							className="signup-form__input"
							disabled={ this.state.submitting || this.props.disabled }
							id="username"
							name="username"
							value={ formState.getFieldValue( this.state.form, 'username' ) }
							isError={ formState.isFieldInvalid( this.state.form, 'username' ) }
							isValid={ formState.isFieldValid( this.state.form, 'username' ) }
							onBlur={ this.handleBlur }
							onChange={ this.handleChangeEvent }
						/>

						{ formState.isFieldInvalid( this.state.form, 'username' ) && (
							<FormInputValidation isError text={ this.getErrorMessagesWithLogin( 'username' ) } />
						) }
					</>
				) }

				<FormLabel htmlFor="password">{ this.props.translate( 'Choose a password' ) }</FormLabel>
				<FormPasswordInput
					className="signup-form__input"
					disabled={ this.state.submitting || this.props.disabled }
					id="password"
					name="password"
					value={ formState.getFieldValue( this.state.form, 'password' ) }
					isError={ formState.isFieldInvalid( this.state.form, 'password' ) }
					isValid={ formState.isFieldValid( this.state.form, 'password' ) }
					onBlur={ this.handleBlur }
					onChange={ this.handleChangeEvent }
					submitting={ this.state.submitting || this.props.submitting }
				/>
				{ this.passwordValidationExplanation() }
			</div>
		);
	}

	handleWooCommerceSocialConnect = ( ...args ) => {
		analytics.tracks.recordEvent( 'wcadmin_storeprofiler_create_jetpack_account', {
			signup_method: 'google',
		} );
		this.props.handleSocialResponse( args );
	};

	handleWooCommerceSubmit = event => {
		event.preventDefault();
		document.activeElement.blur();
		this.formStateController.handleSubmit( hasErrors => {
			if ( hasErrors ) {
				this.setState( { submitting: false } );
				return;
			}
			analytics.tracks.recordEvent( 'wcadmin_storeprofiler_create_jetpack_account', {
				signup_method: 'email',
			} );
		} );
		this.handleSubmit( event );
	};

	renderWooCommerce() {
		return (
			<div>
				<TextControl
					label={ this.props.translate( 'Your email address' ) }
					disabled={
						this.state.submitting || !! this.props.disabled || !! this.props.disableEmailInput
					}
					id="email"
					name="email"
					type="email"
					value={ formState.getFieldValue( this.state.form, 'email' ) }
					onBlur={ this.handleBlur }
					onChange={ value => {
						this.setState( { notice: null } );
						this.formStateController.handleFieldChange( {
							name: 'email',
							value,
						} );
					} }
				/>
				{ this.emailDisableExplanation() }

				{ formState.isFieldInvalid( this.state.form, 'email' ) && (
					<FormInputValidation isError text={ this.getErrorMessagesWithLogin( 'email' ) } />
				) }

				{ this.props.displayUsernameInput && (
					<>
						<TextControl
							label={ this.props.translate( 'Choose a username' ) }
							disabled={ this.state.submitting || this.props.disabled }
							id="username"
							name="username"
							value={ formState.getFieldValue( this.state.form, 'username' ) }
							onBlur={ this.handleBlur }
							onChange={ value => {
								this.setState( { notice: null } );
								this.formStateController.handleFieldChange( {
									name: 'username',
									value,
								} );
							} }
						/>

						{ formState.isFieldInvalid( this.state.form, 'username' ) && (
							<FormInputValidation isError text={ this.getErrorMessagesWithLogin( 'username' ) } />
						) }
					</>
				) }

				<TextControl
					label={ this.props.translate( 'Choose a password' ) }
					disabled={ this.state.submitting || this.props.disabled }
					id="password"
					name="password"
					type="password"
					value={ formState.getFieldValue( this.state.form, 'password' ) }
					onBlur={ this.handleBlur }
					onChange={ value => {
						this.formStateController.handleFieldChange( {
							name: 'password',
							value,
						} );
					} }
				/>

				{ this.passwordValidationExplanation() }

				{ this.props.formFooter || this.formFooter() }
			</div>
		);
	}

	handleOnClickTos = () => {
		analytics.tracks.recordEvent.bind( analytics, 'calypso_signup_tos_link_click' );
	};

	getTermsOfServiceUrl() {
		return localizeUrl( 'https://wordpress.com/tos/' );
	}

	termsOfServiceLink = () => {
		const tosLink = (
			<a
				href={ this.getTermsOfServiceUrl() }
				onClick={ this.handleOnClickTos }
				target="_blank"
				rel="noopener noreferrer"
			/>
		);
		const tosText = this.props.translate(
			'By creating an account you agree to our {{a}}Terms of Service{{/a}}.',
			{
				components: {
					a: tosLink,
				},
			}
		);

		if ( this.props.isSocialSignupEnabled ) {
			return (
				<p className="signup-form__terms-of-service-link">
					{ this.props.translate(
						'By creating an account, you agree to our {{a}}Terms of Service{{/a}}.',
						{
							components: {
								a: tosLink,
							},
						}
					) }
				</p>
			);
		}

		return <p className="signup-form__terms-of-service-link">{ tosText }</p>;
	};

	getNotice() {
		if ( this.props.step && 'invalid' === this.props.step.status ) {
			return this.globalNotice( this.props.step.errors[ 0 ] );
		}
		if ( this.state.notice ) {
			return this.globalNotice( this.state.notice );
		}
		if ( this.userCreationComplete() ) {
			return this.globalNotice( {
				info: true,
				message: this.props.translate(
					'Your account has already been created. You can change your email, username, and password later.'
				),
			} );
		}
		return false;
	}

	emailDisableExplanation() {
		if ( this.props.disableEmailInput && this.props.disableEmailExplanation ) {
			return (
				<FormSettingExplanation noValidate={ true }>
					{ this.props.disableEmailExplanation }
				</FormSettingExplanation>
			);
		}
	}

	passwordValidationExplanation() {
		const passwordValue = formState.getFieldValue( this.state.form, 'password' );

		if ( formState.isFieldInvalid( this.state.form, 'password' ) ) {
			return <FormInputValidation isError text={ this.getErrorMessagesWithLogin( 'password' ) } />;
		}

		if ( passwordValue && passwordValue < 6 ) {
			return (
				<FormSettingExplanation>
					{ this.props.translate( 'Your password must be at least six characters long.' ) }
				</FormSettingExplanation>
			);
		}

		return false;
	}

	formFooter() {
		if ( this.userCreationComplete() ) {
			return (
				<LoggedOutFormFooter>
					<Button primary onClick={ () => this.props.goToNextStep() }>
						{ this.props.translate( 'Continue' ) }
					</Button>
				</LoggedOutFormFooter>
			);
		}
		return (
			<LoggedOutFormFooter isBlended={ this.props.isSocialSignupEnabled }>
				{ this.termsOfServiceLink() }
				<FormButton
					className="signup-form__submit"
					disabled={ this.state.submitting || this.props.disabled }
				>
					{ this.props.submitButtonText }
				</FormButton>
			</LoggedOutFormFooter>
		);
	}

	footerLink() {
		const { flowName, translate } = this.props;

		return (
			<LoggedOutFormLinks>
				<LoggedOutFormLinkItem href={ this.getloginUrl() }>
					{ flowName === 'onboarding'
						? translate( 'Log in to create a site for your existing account.' )
						: translate( 'Already have a WordPress.com account?' ) }
				</LoggedOutFormLinkItem>
				{ this.props.oauth2Client && (
					<LoggedOutFormBackLink
						oauth2Client={ this.props.oauth2Client }
						recordClick={ this.recordBackLinkClick }
					/>
				) }
			</LoggedOutFormLinks>
		);
	}

	userCreationComplete() {
		return this.props.step && 'completed' === this.props.step.status;
	}

	getloginUrl = () => {
		return config.isEnabled( 'login/native-login-links' )
			? this.getLoginLink()
			: localizeUrl( config( 'login_url' ), this.props.locale );
	};

	render() {
		if ( this.getUserExistsError( this.props ) ) {
			return null;
		}

		if ( isCrowdsignalOAuth2Client( this.props.oauth2Client ) ) {
			const socialProps = pick( this.props, [
				'isSocialSignupEnabled',
				'handleSocialResponse',
				'socialService',
				'socialServiceResponse',
			] );

			return (
				<CrowdsignalSignupForm
					disabled={ this.props.disabled }
					formFields={ this.formFields() }
					handleSubmit={ this.handleSubmit }
					loginLink={ this.getloginUrl() }
					oauth2Client={ this.props.oauth2Client }
					recordBackLinkClick={ this.recordBackLinkClick }
					submitting={ this.props.submitting }
					{ ...socialProps }
				/>
			);
		}

		if (
			( config.isEnabled( 'jetpack/connect/woocommerce' ) &&
				this.props.isJetpackWooCommerceFlow ) ||
			( config.isEnabled( 'woocommerce/onboarding-oauth' ) &&
				isWooOAuth2Client( this.props.oauth2Client ) &&
				this.props.wccomFrom )
		) {
			return (
				<div className={ classNames( 'signup-form__woocommerce', this.props.className ) }>
					<LoggedOutForm onSubmit={ this.handleWooCommerceSubmit } noValidate={ true }>
						{ this.props.formHeader && (
							<header className="signup-form__header">{ this.props.formHeader }</header>
						) }

						{ this.renderWooCommerce() }

						{ this.props.isSocialSignupEnabled && ! this.userCreationComplete() && (
							<SocialSignupForm
								handleResponse={ this.handleWooCommerceSocialConnect }
								socialService={ this.props.socialService }
								socialServiceResponse={ this.props.socialServiceResponse }
							/>
						) }
					</LoggedOutForm>

					<LoggedOutFormLinkItem href={ this.getloginUrl() }>
						{ this.props.translate( 'Log in with an existing WordPress.com account' ) }
					</LoggedOutFormLinkItem>
				</div>
			);
		}

		/*
			AB Test: passwordlessSignup

			`<PasswordlessSignupForm />` is for the `onboarding` flow.

			We are testing whether a passwordless account creation and login improves signup rate in the `onboarding` flow
		*/
		if (
			this.props.flowName === 'onboarding' &&
			'passwordless' === abtest( 'passwordlessSignup' )
		) {
			return (
				<div className={ classNames( 'signup-form', this.props.className ) }>
					{ this.getNotice() }
					<PasswordlessSignupForm
						stepName={ this.props.stepName }
						flowName={ this.props.flowName }
						goToNextStep={ this.props.goToNextStep }
						userCreationComplete={ this.userCreationComplete() }
						submitButtonText={ this.props.submitButtonText }
						renderTerms={ this.termsOfServiceLink }
						getloginUrl={ this.getloginUrl }
					/>
					{ this.props.isSocialSignupEnabled && ! this.userCreationComplete() && (
						<SocialSignupForm
							handleResponse={ this.props.handleSocialResponse }
							socialService={ this.props.socialService }
							socialServiceResponse={ this.props.socialServiceResponse }
						/>
					) }

					{ this.props.footerLink || this.footerLink() }
				</div>
			);
		}

		return (
			<div className={ classNames( 'signup-form', this.props.className ) }>
				{ this.getNotice() }

				<LoggedOutForm onSubmit={ this.handleSubmit } noValidate={ true }>
					{ this.props.formHeader && (
						<header className="signup-form__header">{ this.props.formHeader }</header>
					) }

					{ this.formFields() }

					{ this.props.formFooter || this.formFooter() }
				</LoggedOutForm>

				{ this.props.isSocialSignupEnabled && ! this.userCreationComplete() && (
					<SocialSignupForm
						handleResponse={ this.props.handleSocialResponse }
						socialService={ this.props.socialService }
						socialServiceResponse={ this.props.socialServiceResponse }
					/>
				) }

				{ this.props.footerLink || this.footerLink() }
			</div>
		);
	}
}

export default connect(
	state => ( {
		oauth2Client: getCurrentOAuth2Client( state ),
		sectionName: getSectionName( state ),
		isJetpackWooCommerceFlow:
			'woocommerce-setup-wizard' === get( getCurrentQueryArguments( state ), 'from' ),
		wccomFrom: get( getCurrentQueryArguments( state ), 'wccom-from' ),
	} ),
	{
		trackLoginMidFlow: () => recordTracksEvent( 'calypso_signup_login_midflow' ),
		createSocialUserFailed,
	}
)( localize( SignupForm ) );
