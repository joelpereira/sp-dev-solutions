import * as React from 'react';
import styles from './Leads.module.scss';
import { ILeadsProps, ILeadsState, LeadView } from '.';
import { LeadCardActions, LeadCardPreview } from '..';
import { Dropdown } from 'office-ui-fabric-react/lib/Dropdown';
import { DatePicker } from 'office-ui-fabric-react/lib/DatePicker';
import { Spinner, SpinnerSize } from 'office-ui-fabric-react/lib/Spinner';
import { css } from 'office-ui-fabric-react/lib/Utilities';
import { DocumentCard, DocumentCardTitle, DocumentCardActivity, DocumentCardLocation, IDocumentCardActivityPerson } from 'office-ui-fabric-react/lib/DocumentCard';
import { Dialog, DialogType, DialogFooter } from 'office-ui-fabric-react/lib/Dialog';
import { ImageFit } from 'office-ui-fabric-react/lib/Image';
import { Icon } from 'office-ui-fabric-react/lib/Icon';
import { HttpClient, HttpClientResponse } from '@microsoft/sp-http';
import { Placeholder } from "@pnp/spfx-controls-react/lib/Placeholder";
import { SampleLeads } from '../../../../SampleLeads';
import { LeadComment, Lead, Person } from '../../../../Lead';
import { BaseButton, Button, DefaultButton, PrimaryButton } from 'office-ui-fabric-react/lib/Button';

export class Leads extends React.Component<ILeadsProps, ILeadsState> {
  constructor(props: ILeadsProps) {
    super(props);

    this.state = {
      loading: false,
      error: undefined,
      leads: [],
      reminderCreating: false,
      reminderDialogVisible: false,
      submitCardDialogVisible: false,
      view: typeof props.view !== 'undefined' ? props.view : LeadView.new
    };
  }

  private loadLeads(view: LeadView): void {
    if (this.props.needsConfiguration) {
      return;
    }

    this.setState({
      loading: true,
      error: undefined
    });

    this
      .getData()
      .then((data: Lead[]): void => {
        let leads: Lead[] = data;
        switch (view) {
          case LeadView.new:
            leads = data.sort((a, b) => (b.createdOn as any) - (a.createdOn as any));
            break;
          case LeadView.mostProbable:
            leads = data.sort((a, b) => b.percentComplete - a.percentComplete);
            break;
          case LeadView.recentComments:
            leads = data.sort((a, b) => (this.getLastCommentDate(b) as any) - (this.getLastCommentDate(a) as any));
            break;
          case LeadView.requireAttention:
            leads = data.filter(l => l.requiresAttention === true);
            break;
        }

        this.setState({
          loading: false,
          leads: leads
        });
      }, (error: any): void => {
        this.setState({
          loading: false,
          error: error
        });
      });
  }

  private getData(): Promise<Lead[]> {
    if (this.props.demo) {
      return Promise.resolve(SampleLeads.leads);
    }
    else {
      return this.props.httpClient.get(this.props.leadsApiUrl, HttpClient.configurations.v1)
        .then((res: HttpClientResponse) => res.json());
    }
  }

  private getLastCommentDate(lead: Lead): Date {
    let date: Date = new Date(0);

    if (lead.comments && lead.comments.length > 0) {
      date = new Date(lead.comments[lead.comments.length - 1].date);
    }

    return date;
  }

  private viewChanged = (item): void => {
    this.setState({
      view: item.data
    });
    this.loadLeads(item.data);
  }

  private leadClicked = (ev?: React.SyntheticEvent<HTMLElement>): void => {
    if (!this.props.teamsContext ||
      !this.props.host ||
      !this.props.host._teamsManager ||
      !this.props.host._teamsManager._appContext ||
      !this.props.host._teamsManager._appContext.applicationName) {
      return;
    }

    const host: string = this.props.host._teamsManager._appContext.applicationName;
    if (host !== 'TeamsTaskModuleApplication') {
      return;
    }

    const leadElement: HTMLElement = ev.currentTarget;
    const leadId: string = leadElement.dataset.leadid;
    if (!leadId) {
      return;
    }

    const selectedLead: Lead[] = this.state.leads.filter(lead => lead.id === leadId);
    if (selectedLead.length < 1) {
      return;
    }

    this.setState({ submitCardDialogVisible: true });
    this.props.teamsContext.tasks.submitTask(selectedLead[0]);
  }

  private leadShared = (): void => {
  }

  private leadFollowed = (): void => {
  }

  private showCreateLeadReminderDialog = (ev?: React.MouseEvent<HTMLDivElement | HTMLAnchorElement | HTMLButtonElement | BaseButton | Button, MouseEvent>): void => {
    const leadElement: any = ev.currentTarget;
    const leadId: string = leadElement.dataset.leadid;
    if (!leadId) {
      return;
    }

    const selectedLead: Lead[] = this.state.leads.filter(lead => lead.id === leadId);
    if (selectedLead.length < 1) {
      return;
    }

    this.setState({
      selectedLead: selectedLead[0],
      reminderDialogVisible: true,
      reminderCreating: false,
      reminderCreatingResult: undefined,
      reminderDate: new Date()
    });
  }

  private createLeadReminder = () => {
    this.setState({
      reminderCreating: true,
      reminderCreatingResult: undefined
    });

    const dueDate: Date = this.state.reminderDate;
    const reminder: string = `Review lead ${this.state.selectedLead.title}`;
    const taskAssignment: any = {};
    taskAssignment[this.props.userId] = {
      "@odata.type": "#microsoft.graph.plannerAssignment",
      orderHint: " !"
    };

    let planId: string;
    let taskId: string;
    this
      .ensureSalesGroup()
      .then((salesGroupId: string): Promise<string> => this.ensureSalesPlan(salesGroupId))
      .then((_planId: string): Promise<string> => {
        planId = _planId;
        return this.ensureToDoBucket(planId);
      })
      // create task
      .then((bucketId: string) => this.props.msGraphClient
        .api('planner/tasks')
        .post({
          planId: planId,
          bucketId: bucketId,
          title: reminder,
          assignments: taskAssignment,
          dueDateTime: dueDate.toISOString()
        }))
      // retrieve task details to get ETag required to add a task description
      .then((task: { id: string }) => {
        taskId = task.id;
        return this.props.msGraphClient
        .api(`planner/tasks/${task.id}/details`)
        .get();
      })
      // add task description
      .then((taskDetails: { '@odata.etag': string }) => this.props.msGraphClient
        .api(`planner/tasks/${taskId}/details`)
        .header('If-Match', taskDetails["@odata.etag"])
        .patch({
          description: location.href
        }))
      .then((): void => {
        this.setState({
          reminderCreating: false,
          reminderCreatingResult: 'OK'
        });
      }, (err: any): void => {
        this.setState({
          reminderCreating: false,
          reminderCreatingResult: err
        });
      });
  }

  private closeCreateReminderDialog = () => {
    this.setState({
      reminderDialogVisible: false
    });
  }

  private ensureSalesGroup(): Promise<string> {
    const groupName: string = 'Sales';

    return this.props.msGraphClient
      .api(`groups?$filter=groupTypes/any(c:c+eq+'Unified') and displayName eq '${groupName}'&$select=id`)
      .get()
      .then((groups: { value: { id: string }[] }): Promise<string> => {
        if (groups.value.length > 0) {
          return Promise.resolve(groups.value[0].id);
        }

        return this.props.msGraphClient
          .api(`/groups`)
          .post({
            displayName: groupName,
            owners: [this.props.userId],
            groupTypes: ['Unified'],
            mailEnabled: true,
            mailNickname: groupName.toLowerCase(),
            securityEnabled: true
          })
          .then((group: { id: string }): Promise<string> => Promise.resolve(group.id));
      })
      .then((groupId: string): Promise<string> => Promise.resolve(groupId));
  }

  private ensureSalesPlan(groupId: string): Promise<string> {
    const planName: string = 'Sales';

    return this.props.msGraphClient
      .api(`groups/${groupId}/planner/plans?$filter=title eq '${planName}'&$select=id`)
      .get()
      .then((plans: { value: { id: string }[] }): Promise<string> => {
        if (plans.value.length > 0) {
          return Promise.resolve(plans.value[0].id);
        }

        return this.props.msGraphClient
          .api('/planner/plans')
          .post({
            owner: groupId,
            title: planName
          })
          .then((plan: { id: string }): Promise<string> => Promise.resolve(plan.id));
      })
      .then((planId: string): Promise<string> => Promise.resolve(planId));
  }

  private ensureToDoBucket(planId: string): Promise<string> {
    const bucketName: string = 'To do';

    return this.props.msGraphClient
      .api(`planner/plans/${planId}/buckets?$filter=name eq '${bucketName}'&$select=id`)
      .get()
      .then((buckets: { value: { id: string }[] }): Promise<string> => {
        if (buckets.value.length > 0) {
          return Promise.resolve(buckets.value[0].id);
        }

        return this.props.msGraphClient
          .api('/planner/buckets')
          .post({
            planId: planId,
            name: bucketName
          })
          .then((bucket: { id: string }): Promise<string> => Promise.resolve(bucket.id));
      })
      .then((bucketId: string): Promise<string> => Promise.resolve(bucketId));
  }

  public componentDidMount(): void {
    this.loadLeads(this.state.view);
  }

  public componentDidUpdate(prevProps: ILeadsProps, prevState: ILeadsState, snapshot?: any): void {
    if (this.props.demo !== prevProps.demo) {
      this.loadLeads(this.state.view);
    }
  }

  private getCommentsForCard(comments: LeadComment[]): any {
    return comments.map(c => {
      return {
        name: c.comment,
        url: '#',
        previewImageSrc: '',
        iconSrc: SampleLeads.getPhotoUrl(c.createdBy.email),
        imageFit: ImageFit.cover,
        width: 318,
        height: 196
      };
    });
  }

  private getDisplayDate(d: string): string {
    const date: Date = new Date(d);
    let displayDate: string = date.toLocaleDateString();
    const dateYear: number = date.getFullYear();
    const now: Date = new Date();

    if (dateYear === now.getFullYear()) {
      displayDate = displayDate.replace(dateYear.toString(), '').replace(/(^[^\d]|[^\d]$)/g, '');
    }

    return displayDate;
  }

  private getDistinctContributors(createdBy: Person, comments: LeadComment[]): Person[] {
    const contributors: Person[] = [];

    comments.forEach(c => {
      if (c.createdBy.email === createdBy.email) {
        return;
      }

      for (let i: number = 0; i < contributors.length; i++) {
        if (contributors[i].email === c.createdBy.email) {
          return;
        }
      }

      contributors.push(c.createdBy);
    });

    return contributors;
  }

  public render(): React.ReactElement<ILeadsProps> {
    const { error, loading, leads, view, submitCardDialogVisible, reminderDialogVisible, reminderCreating, reminderCreatingResult, reminderDate } = this.state;
    const { needsConfiguration } = this.props;

    if (needsConfiguration) {
      return <div className={css(styles.leads, 'ms-Fabric')}>
        <Placeholder
          iconName='Chart'
          iconText='Configure your environment'
          description='The required LeadsApiUrl tenant property is not configured. Please configure the property before using this web part.' />
      </div>;
    }

    return (
      <div className={css(styles.leads, 'ms-Fabric')}>
        {loading &&
          <Spinner label='Loading Leads...' size={SpinnerSize.large} />}
        {!loading &&
          error &&
          <div>The following error has occurred while loading Leads: {this.state.error}</div>}
        {!loading &&
          !error &&
          leads.length === 0 &&
          <div>No Leads found</div>}
        {!loading &&
          !error &&
          leads.length > 0 &&
          <div>
            <div className={styles.viewWrapper}>
              <div className={styles.title}>Leads from the Lead Management System</div>
              {typeof this.props.view === 'undefined' &&
                <Dropdown
                  placeHolder='Select view'
                  className={styles.view}
                  options={
                    [
                      { key: 'new', text: 'New Leads', data: LeadView.new },
                      { key: 'mostProbable', text: 'Most probable', data: LeadView.mostProbable },
                      { key: 'recentComments', text: 'Recently commented', data: LeadView.recentComments },
                      { key: 'requireAttention', text: 'Require attention', data: LeadView.requireAttention }
                    ]
                  }
                  selectedKey={LeadView[view]}
                  onChanged={this.viewChanged} />
              }
            </div>
            <div className={styles.cards}>
              {
                leads.map(l =>
                  <DocumentCard onClick={this.leadClicked} className={styles.card} key={l.id} data-leadid={l.id}>
                    <div className={styles.cardContents}>
                      <div>
                        <LeadCardPreview previewItems={this.getCommentsForCard(l.comments.reverse())} />
                        {l.requiresAttention === true &&
                          <Icon iconName='Info' className={styles.urgent} />}
                        <DocumentCardLocation location={l.account} locationHref='#' />
                        <DocumentCardTitle title={l.title} shouldTruncate={true} />
                        <div className={styles.titleSecondary}><DocumentCardTitle title={l.description!} shouldTruncate={true} /></div>
                      </div>
                      <div>
                        <DocumentCardActivity
                          activity={`Created ${this.getDisplayDate(l.createdOn)}`}
                          people={
                            ([] as IDocumentCardActivityPerson[])
                              .concat([{ name: l.createdBy.name, profileImageSrc: SampleLeads.getPhotoUrl(l.createdBy.email) }])
                              .concat(this.getDistinctContributors(l.createdBy, l.comments).map(c => {
                                return {
                                  name: c.name,
                                  profileImageSrc: SampleLeads.getPhotoUrl(c.email)
                                };
                              }))
                          }
                        />
                        <LeadCardActions
                          actions={
                            [
                              {
                                iconProps: { iconName: 'Share' },
                                onClick: this.leadShared,
                                ariaLabel: 'Share Lead'
                              },
                              {
                                iconProps: { iconName: 'View' },
                                onClick: this.leadFollowed,
                                ariaLabel: 'Follow Lead'
                              },
                              {
                                iconProps: { iconName: 'AlarmClock' },
                                onClick: this.showCreateLeadReminderDialog,
                                ariaLabel: 'Remind me about this lead',
                                'data-leadid': l.id
                              } as any
                            ]
                          }
                          percentComplete={l.percentComplete}
                          change={l.change} />
                      </div>
                    </div>
                  </DocumentCard>
                )
              }
            </div>
            <Dialog
              hidden={!submitCardDialogVisible}
              dialogContentProps={{
                type: DialogType.normal,
                title: 'Loading data'
              }}
              styles={{
                main: [{
                  selectors: {
                    ['@media (min-width: 480px)']: {
                      minWidth: '500px',
                      minHeight: '200px'
                    }
                  }
                }]
              }}
              modalProps={{
                isBlocking: true,
                dragOptions: undefined,
              }}>
              <Spinner label='Loading data from the Lead Management System...' labelPosition='right' size={SpinnerSize.large} style={{ margin: '2em auto' }} />
            </Dialog>
            <Dialog
              hidden={!reminderDialogVisible}
              dialogContentProps={{
                type: DialogType.normal,
                title: 'Remind me about this lead'
              }}
              styles={{
                main: [{
                  selectors: {
                    ['@media (min-width: 480px)']: {
                      minWidth: '500px',
                      minHeight: '200px'
                    }
                  }
                }]
              }}
              modalProps={{
                isBlocking: true,
                dragOptions: undefined,
              }}>
              <div>
                {!reminderCreating &&
                  <div>
                    <DatePicker
                      disabled={reminderCreatingResult === 'OK'}
                      label='Remind me about this lead on'
                      value={this.state.reminderDate}
                      onSelectDate={(date: Date | null | undefined) => this.setState({ reminderDate: date })}
                    />
                    {reminderCreatingResult === 'OK' &&
                      <div style={{ color: 'green' }}>Reminder successfully created</div>}
                    {reminderCreatingResult &&
                      reminderCreatingResult !== 'OK' &&
                      <div style={{ color: 'red' }}>An error has occurred while creating the reminder: {reminderCreatingResult}</div>}
                  </div>
                }
                {reminderCreating &&
                  <Spinner label='Creating reminder...' labelPosition='right' size={SpinnerSize.large} style={{ margin: '2em auto' }} />}
              </div>
              <DialogFooter>
                <DefaultButton onClick={() => this.closeCreateReminderDialog()} text={reminderCreatingResult === 'OK' ? 'Close' : 'Cancel'} disabled={reminderCreating} />
                <PrimaryButton onClick={() => this.createLeadReminder()} text='Create reminder' disabled={typeof reminderDate === 'undefined' || reminderCreatingResult === 'OK'} />
              </DialogFooter>
            </Dialog>
          </div>
        }
      </div>
    );
  }
}
