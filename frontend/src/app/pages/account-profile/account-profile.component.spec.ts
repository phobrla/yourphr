import {ComponentFixture, TestBed} from '@angular/core/testing';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {of, throwError} from 'rxjs';
import {RouterTestingModule} from '@angular/router/testing';

import {AccountProfileComponent} from './account-profile.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {AuthService} from '../../services/auth.service';
import {ReportHeaderComponent} from 'src/app/components/report-header/report-header.component';

describe('AccountProfileComponent', () => {
  let component: AccountProfileComponent;
  let fixture: ComponentFixture<AccountProfileComponent>;
  let api: jasmine.SpyObj<FastenApiService>;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', [
      'getCurrentUser', 'deleteAccount', 'getSummary', 'getResources', 'changePassword',
      'getLegalConsent', 'grantLegalConsent', 'revokeLegalConsent', 'signOutEverywhere',
      'getAccessLog', 'trimAccessLog', 'getAccountTerminologyFiles', 'setAccountTerminologyFile',
    ]);
    api.signOutEverywhere.and.returnValue(of(true));
    api.getAccessLog.and.returnValue(of([]));
    api.getAccountTerminologyFiles.and.returnValue(of({}));
    api.setAccountTerminologyFile.and.returnValue(of(true));
    // "Sign out everywhere" (#508) clears the local token after the server revokes it, so the
    // component now depends on AuthService. Stubbed rather than real — the real one wants an HTTP
    // client token that this TestBed does not provide.
    auth = jasmine.createSpyObj('AuthService', ['Logout']);
    auth.Logout.and.returnValue(Promise.resolve());
    api.getCurrentUser.and.returnValue(of({username: 'jim', full_name: 'Jim Willeke', email: 'jim@example.com', role: 'admin'}));
    api.deleteAccount.and.returnValue(of(true));
    api.changePassword.and.returnValue(of(true));
    api.getLegalConsent.and.returnValue(of({
      accepted: false,
      privacy_policy_url: 'https://yourphr.org/privacy.html',
      terms_of_service_url: 'https://yourphr.org/terms.html',
    }));
    api.grantLegalConsent.and.returnValue(of({
      accepted: true,
      accepted_at: '2026-07-31T12:00:00Z',
      privacy_policy_url: 'https://yourphr.org/privacy.html',
      terms_of_service_url: 'https://yourphr.org/terms.html',
    }));
    api.revokeLegalConsent.and.returnValue(of({
      accepted: false,
      privacy_policy_url: 'https://yourphr.org/privacy.html',
      terms_of_service_url: 'https://yourphr.org/terms.html',
      medicare_sources_disconnected: 0,
    }));
    // ReportHeaderComponent (rendered via <report-header>) calls these on init.
    api.getSummary.and.returnValue(of({sources: []} as any));
    api.getResources.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      declarations: [AccountProfileComponent, ReportHeaderComponent],
      imports: [CommonModule, FormsModule, RouterTestingModule],
      providers: [
        {provide: FastenApiService, useValue: api},
        {provide: AuthService, useValue: auth},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads the current user', () => {
    expect(component).toBeTruthy();
    expect(api.getCurrentUser).toHaveBeenCalled();
    expect(component.user.username).toBe('jim');
    expect(component.loading.page).toBeFalse();
  });

  it('computes initials from the full name', () => {
    expect(component.initials).toBe('JW');
  });

  it('shows a mapping for every terminology file and saves individual mappings', () => {
    expect(component.terminologyFiles.length).toBe(6);
    expect(component.terminologyLoaded).toBeTrue();
    const file = component.terminologyFiles[0];
    file.path = ' /data/terminology/Loinc.csv ';
    component.saveTerminologyFile(file);
    expect(api.setAccountTerminologyFile).toHaveBeenCalledWith(file.key, '/data/terminology/Loinc.csv');
    expect(file.savedPath).toBe('/data/terminology/Loinc.csv');
    expect(file.message).toContain('not been imported');
    file.path = '';
    component.saveTerminologyFile(file);
    expect(file.savedPath).toBe('');
    expect(file.message).toBe('Mapping removed.');
  });

  it('keeps the saved mapping on failure and exposes load/save errors', () => {
    const file = component.terminologyFiles[0];
    file.path = 'relative.csv';
    api.setAccountTerminologyFile.and.returnValue(throwError(() => ({error: {error: 'absolute path required'}})));
    component.saveTerminologyFile(file);
    expect(file.error).toBe('absolute path required');
    expect(file.savedPath).toBe('');
    api.getAccountTerminologyFiles.and.returnValue(throwError(() => new Error('offline')));
    component.loadTerminologyFiles();
    expect(component.terminologyLoaded).toBeFalse();
    expect(component.terminologyError).toContain('Could not load');
  });

  it('shows editable mappings to regular members', async () => {
    api.getAccountTerminologyFiles.calls.reset();
    api.getCurrentUser.and.returnValue(of({username: 'member', role: 'user'}));
    component.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.getAccountTerminologyFiles).toHaveBeenCalled();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Terminology file mappings');
    expect(element.querySelector<HTMLInputElement>('[id="yourphr.terminology.loinc.table"]')!.disabled).toBeFalse();
  });

  it('loads previously saved account paths for editing', async () => {
    api.getAccountTerminologyFiles.and.returnValue(of({'yourphr.terminology.loinc.table': '/data/Loinc.csv'}));
    component.loadTerminologyFiles();
    fixture.detectChanges();
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    const input = element.querySelector<HTMLInputElement>('[id="yourphr.terminology.loinc.table"]')!;
    expect(input.disabled).toBeFalse();
    expect(input.value).toBe('/data/Loinc.csv');
  });

  it('refuses editing when loading fails', async () => {
    api.getAccountTerminologyFiles.and.returnValue(throwError(() => new Error('offline')));
    component.loadTerminologyFiles();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.terminologyLoaded).toBeFalse();
    expect(component.terminologyError).toContain('Could not load');
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector<HTMLInputElement>('[id="yourphr.terminology.loinc.table"]')!.disabled).toBeTrue();
  });

  // #508: the server has already invalidated this browser's token, so the component must clear the
  // local copy and get out of the way — otherwise the next request 401s instead of showing sign-in.
  it('signs out locally after revoking every session', async () => {
    component.signOutEverywhere();
    await Promise.resolve();

    expect(api.signOutEverywhere).toHaveBeenCalled();
    expect(auth.Logout).toHaveBeenCalled();
  });

  it('reports a failure to revoke rather than pretending it worked', () => {
    api.signOutEverywhere.and.returnValue(throwError(() => ({error: {error: 'could not sign out other sessions'}})));

    component.signOutEverywhere();

    expect(component.signOutError).toContain('could not sign out');
    expect(auth.Logout).not.toHaveBeenCalled();
  });

  it('falls back to the first two letters when there is only one name part', () => {
    component.user = {username: 'jim'};
    expect(component.initials).toBe('JI');
  });

  it('delegates account deletion to the API', () => {
    component.deleteAccount();
    expect(api.deleteAccount).toHaveBeenCalled();
  });

  it('loads legal consent status', () => {
    expect(api.getLegalConsent).toHaveBeenCalled();
    expect(component.legalConsent?.accepted).toBeFalse();
  });

  it('refuses grant without the opt-in checkbox', () => {
    component.legalOptInChecked = false;
    component.grantLegalConsent();
    expect(api.grantLegalConsent).not.toHaveBeenCalled();
  });

  it('grants consent when the opt-in checkbox is checked', () => {
    component.legalOptInChecked = true;
    component.grantLegalConsent();
    expect(api.grantLegalConsent).toHaveBeenCalled();
    expect(component.legalConsent?.accepted).toBeTrue();
  });

  it('revokes consent via the API', () => {
    component.legalConsent = {accepted: true, accepted_at: '2026-07-31T12:00:00Z', privacy_policy_url: 'https://yourphr.org/privacy.html', terms_of_service_url: 'https://yourphr.org/terms.html'};
    component.revokeLegalConsent();
    expect(api.revokeLegalConsent).toHaveBeenCalled();
    expect(component.legalConsent?.accepted).toBeFalse();
  });

  it('rejects a password change when the new passwords do not match (no API call)', () => {
    component.pw = {current: 'old', next: 'new12345', confirm: 'different'};
    component.changePassword();
    expect(api.changePassword).not.toHaveBeenCalled();
    expect(component.pwError).toContain('do not match');
  });

  it('changes the password and clears the form on success', () => {
    component.pw = {current: 'old', next: 'new12345', confirm: 'new12345'};
    component.changePassword();
    expect(api.changePassword).toHaveBeenCalledWith('old', 'new12345');
    expect(component.pwSuccess).toBeTrue();
    expect(component.pw.current).toBe('');
  });

  it('surfaces the server error message on failure', () => {
    api.changePassword.and.returnValue(throwError(() => ({error: {error: 'current password is incorrect'}})));
    component.pw = {current: 'wrong', next: 'new12345', confirm: 'new12345'};
    component.changePassword();
    expect(component.pwError).toBe('current password is incorrect');
    expect(component.pwSuccess).toBeFalse();
  });

  // yourphr#507: the person trims their own log; it asks first, then says what it did.
  it('trims older access-log entries only after the person confirms, and says how many went', () => {
    api.trimAccessLog.and.returnValue(of({removed: 3, before: '2026-07-03'}));
    component.trimAccessLog();
    expect(api.trimAccessLog).toHaveBeenCalled();
    expect(component.trimResult).toBe('Removed 3 entries from before 2026-07-03.');
    expect(component.confirmingTrim).toBeFalse();
    expect(api.getAccessLog).toHaveBeenCalled(); // the table reloads
  });

  it('says so when there was nothing old enough to trim', () => {
    api.trimAccessLog.and.returnValue(of({removed: 0, before: '2026-07-03'}));
    component.trimAccessLog();
    expect(component.trimResult).toBe('Nothing older than 2026-07-03 to remove.');
  });
});
